import { and, eq, gt, isNull, lte, or } from 'drizzle-orm'
import { db } from '#/db'
import {
  chatMessages,
  platformSanctions,
  reports,
  roomBans,
  roomMemberships,
  rooms,
  streamSessions,
  user,
} from '#/db/schema'
import { logEvent } from './logger'
import { enforceRateLimit, rateLimitKeys, rateLimitRules } from './rate-limit'
import type { Thumbnail } from './thumbnail-store'
import { getThumbnail } from './thumbnail-store'

type ReportTargetType = 'account' | 'room' | 'stream_session' | 'chat_message'
type ReportTarget = { roomId?: string; thumbnail?: Thumbnail }

export class ModerationServiceError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

async function roomExists(roomId: string) {
  const rows = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1)
  return rows.length > 0
}

async function loadReportTarget(
  targetType: ReportTargetType,
  targetId: string,
): Promise<ReportTarget | undefined> {
  if (targetType === 'account') {
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, targetId))
      .limit(1)
    return rows.at(0) ? {} : undefined
  }

  if (targetType === 'room') {
    const rows = await db
      .select({ roomId: rooms.id })
      .from(rooms)
      .where(eq(rooms.id, targetId))
      .limit(1)
    return rows.at(0)
  }

  if (targetType === 'stream_session') {
    const rows = await db
      .select({ roomId: streamSessions.roomId })
      .from(streamSessions)
      .where(eq(streamSessions.id, targetId))
      .limit(1)
    const target = rows.at(0)
    if (!target) return undefined
    return { ...target, thumbnail: getThumbnail(targetId) }
  }

  const rows = await db
    .select({ roomId: chatMessages.roomId })
    .from(chatMessages)
    .where(eq(chatMessages.id, targetId))
    .limit(1)
  return rows.at(0)
}

export async function banRoomMember({
  roomId,
  targetUserId,
  bannedByUserId,
  reason,
}: {
  roomId: string
  targetUserId: string
  bannedByUserId: string
  reason?: string
}) {
  const [ban] = await db
    .insert(roomBans)
    .values({ roomId, bannedUserId: targetUserId, bannedByUserId, reason })
    .returning()

  await db
    .update(roomMemberships)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(roomMemberships.roomId, roomId),
        eq(roomMemberships.userId, targetUserId),
        isNull(roomMemberships.leftAt),
      ),
    )

  logEvent('room-ban:create', { roomId, userId: bannedByUserId, targetUserId })
  return ban
}

export async function clearRoomBan({
  roomId,
  targetUserId,
  clearedByUserId,
}: {
  roomId: string
  targetUserId: string
  clearedByUserId: string
}) {
  const banRows = await db
    .update(roomBans)
    .set({ clearedAt: new Date(), clearedByUserId })
    .where(
      and(
        eq(roomBans.roomId, roomId),
        eq(roomBans.bannedUserId, targetUserId),
        isNull(roomBans.clearedAt),
      ),
    )
    .returning()
  const ban = banRows.at(0)
  if (ban !== undefined) {
    logEvent('room-ban:clear', {
      roomId,
      userId: clearedByUserId,
      targetUserId,
    })
  }
  return ban
}

export async function createSanction({
  userId,
  type,
  reason,
  createdByUserId,
  startsAt,
  expiresAt,
}: {
  userId: string
  type: 'stream_ban' | 'chat_ban' | 'room_creation_ban' | 'full_suspension'
  reason: string
  createdByUserId: string
  startsAt?: Date
  expiresAt?: Date
}) {
  const [sanction] = await db
    .insert(platformSanctions)
    .values({ userId, type, reason, createdByUserId, startsAt, expiresAt })
    .returning()
  logEvent('platform-sanction:create', {
    sanctionId: sanction.id,
    userId: createdByUserId,
    targetUserId: userId,
    sanctionType: type,
  })
  return sanction
}

export async function liftSanction({
  sanctionId,
  liftedByUserId,
}: {
  sanctionId: string
  liftedByUserId: string
}) {
  const sanctionRows = await db
    .update(platformSanctions)
    .set({ liftedAt: new Date(), liftedByUserId })
    .where(
      and(
        eq(platformSanctions.id, sanctionId),
        isNull(platformSanctions.liftedAt),
      ),
    )
    .returning()
  if (sanctionRows.length > 0) {
    const sanction = sanctionRows[0]
    logEvent('platform-sanction:lift', {
      sanctionId,
      userId: liftedByUserId,
      targetUserId: sanction.userId,
    })
    return sanction
  }

  const existing = await db
    .select({ id: platformSanctions.id })
    .from(platformSanctions)
    .where(eq(platformSanctions.id, sanctionId))
    .limit(1)
  throw new ModerationServiceError(
    existing.length > 0 ? 'CONFLICT' : 'NOT_FOUND',
  )
}

export async function hasEffectiveSanction(
  userId: string,
  type: 'stream_ban' | 'chat_ban' | 'room_creation_ban' | 'full_suspension',
) {
  const rows = await db
    .select({ id: platformSanctions.id })
    .from(platformSanctions)
    .where(
      and(
        eq(platformSanctions.userId, userId),
        eq(platformSanctions.type, type),
        isNull(platformSanctions.liftedAt),
        lte(platformSanctions.startsAt, new Date()),
        or(
          isNull(platformSanctions.expiresAt),
          gt(platformSanctions.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1)

  return rows.length > 0
}

export async function createReport({
  reporterUserId,
  targetType,
  targetId,
  roomId,
  reason,
  details,
}: {
  reporterUserId: string
  targetType: ReportTargetType
  targetId: string
  roomId?: string
  reason: string
  details?: string
}) {
  await enforceRateLimit(
    rateLimitKeys.reportCreate(reporterUserId),
    rateLimitRules.reportCreate,
  )
  if (await hasEffectiveSanction(reporterUserId, 'full_suspension')) {
    throw new ModerationServiceError('FULLY_SUSPENDED')
  }

  const target = await loadReportTarget(targetType, targetId)
  if (!target) throw new ModerationServiceError('NOT_FOUND')
  if (roomId && target.roomId && roomId !== target.roomId) {
    throw new ModerationServiceError('NOT_FOUND')
  }
  if (roomId && !target.roomId && !(await roomExists(roomId))) {
    throw new ModerationServiceError('NOT_FOUND')
  }

  const [report] = await db
    .insert(reports)
    .values({
      reporterUserId,
      targetType,
      targetId,
      roomId: target.roomId ?? roomId,
      reason,
      details,
      thumbnailSnapshot: target.thumbnail
        ? Buffer.from(target.thumbnail.bytes)
        : undefined,
      thumbnailContentType: target.thumbnail?.contentType,
    })
    .returning()
  logEvent('report:create', {
    reportId: report.id,
    userId: reporterUserId,
    roomId: report.roomId,
    targetType,
  })
  return report
}

export async function loadReportThumbnail(reportId: string) {
  const rows = await db
    .select({
      bytes: reports.thumbnailSnapshot,
      contentType: reports.thumbnailContentType,
    })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1)
  const snapshot = rows.at(0)
  if (!snapshot?.bytes || !snapshot.contentType) return undefined
  return { bytes: snapshot.bytes, contentType: snapshot.contentType }
}
