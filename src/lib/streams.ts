import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#/db'
import { streamSessions } from '#/db/schema'
import { logEvent } from './logger'
import { hasEffectiveSanction } from './moderation'
import type { RateLimitStore } from './rate-limit'
import { enforceRateLimit, rateLimitKeys, rateLimitRules } from './rate-limit'
import type { Thumbnail } from './thumbnail-store'
import { deleteThumbnail, getThumbnail, setThumbnail } from './thumbnail-store'

export const maxThumbnailBytes = 100 * 1024
export const thumbnailUploadIntervalMs = 110_000

export class StreamServiceError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export function canStartStreamFromUserAgent(userAgent: string) {
  const isChromium = /(?:Chrome|Chromium|Edg)\//.test(userAgent)
  return isChromium && !/Firefox\//.test(userAgent)
}

export async function startStream({
  roomId,
  userId,
  hasVideo,
  hasAudio,
  displaySurface,
  label,
}: {
  roomId: string
  userId: string
  hasVideo: boolean
  hasAudio: boolean
  displaySurface?: string
  label?: string
}) {
  if (await hasEffectiveSanction(userId, 'full_suspension')) {
    throw new StreamServiceError('FULLY_SUSPENDED')
  }
  if (await hasEffectiveSanction(userId, 'stream_ban')) {
    throw new StreamServiceError('STREAM_BANNED')
  }
  const [stream] = await db
    .insert(streamSessions)
    .values({ roomId, userId, hasVideo, hasAudio, displaySurface, label })
    .returning()
  logEvent('stream:start', { roomId, userId, streamSessionId: stream.id })
  return stream
}

export async function stopStream({
  streamSessionId,
  roomId,
  userId,
  reason,
}: {
  streamSessionId: string
  roomId: string
  userId: string
  reason: 'self' | 'host' | 'disconnect' | 'socket_replaced' | 'room_ended'
}) {
  const rows = await db
    .update(streamSessions)
    .set({ endedAt: new Date(), stopReason: reason })
    .where(
      and(
        eq(streamSessions.id, streamSessionId),
        eq(streamSessions.roomId, roomId),
        eq(streamSessions.userId, userId),
        isNull(streamSessions.endedAt),
      ),
    )
    .returning()
  const stream = rows.at(0)
  if (stream === undefined) throw new StreamServiceError('STREAM_NOT_ACTIVE')

  deleteThumbnail(streamSessionId)
  logEvent('stream:stop', { roomId, userId, streamSessionId, reason })
  return stream
}

export async function storeThumbnail({
  streamSessionId,
  roomId,
  userId,
  thumbnail,
  now = new Date(),
  rateLimitStore,
}: {
  streamSessionId: string
  roomId: string
  userId: string
  thumbnail: Thumbnail
  now?: Date
  rateLimitStore?: RateLimitStore
}) {
  if (thumbnail.bytes.byteLength > maxThumbnailBytes) {
    logEvent('stream:thumbnail:reject', {
      roomId,
      userId,
      streamSessionId,
      errorCode: 'THUMBNAIL_TOO_LARGE',
    })
    throw new StreamServiceError('THUMBNAIL_TOO_LARGE')
  }

  const rows = await db
    .select()
    .from(streamSessions)
    .where(
      and(
        eq(streamSessions.id, streamSessionId),
        eq(streamSessions.roomId, roomId),
        isNull(streamSessions.endedAt),
      ),
    )
    .limit(1)
  const stream = rows.at(0)
  if (stream === undefined) throw new StreamServiceError('STREAM_NOT_ACTIVE')
  if (stream.userId !== userId) throw new StreamServiceError('FORBIDDEN')

  try {
    await enforceRateLimit(
      rateLimitKeys.streamThumbnail(streamSessionId),
      rateLimitRules.streamThumbnail,
      rateLimitStore,
    )
  } catch {
    logEvent('stream:thumbnail:reject', {
      roomId,
      userId,
      streamSessionId,
      errorCode: 'RATE_LIMITED',
    })
    throw new StreamServiceError('RATE_LIMITED')
  }

  setThumbnail(streamSessionId, thumbnail)
  await db
    .update(streamSessions)
    .set({ thumbnailUpdatedAt: now })
    .where(eq(streamSessions.id, streamSessionId))
  return { ...stream, thumbnailUpdatedAt: now }
}

export { getThumbnail }
