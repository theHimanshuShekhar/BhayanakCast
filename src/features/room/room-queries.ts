import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import {
  getProductionAuth,
  readSessionProjection,
} from '../../server/auth/auth'
import {
  getProductionRoomService,
  validateConfirmation,
  validateCreateRoomInput,
  validateRoomId,
  ROOM_ID,
} from '../home/create-room'
import type {
  AdmitResult,
  LeaveResult,
  MembershipConfirmation,
} from '../../server/rooms/room-service'
import type { RoomRouteProjection } from '../../server/rooms/room-projection'
import { normalizeHomeRealtimeEvent } from '../../server/realtime/home-events'
import {
  getChatService,
  getStreamService,
  getSubscriptionService,
  publishRoomEvent,
} from '../../server/rooms/room-runtime'
import type {
  HostStopStreamResult,
  StartStreamResult,
  StopStreamResult,
} from '../../server/streams/stream-service'
import type { SubscriptionResult } from '../../server/streams/subscription-service'
import type {
  RoomActivityKind,
  RoomChatMessage,
} from '../../server/realtime/room-events'
import {
  REPORT_REASONS,
  submitReport,
  type ReportReason,
  type ReportTargetType,
  type SubmitReportResult,
} from '../../server/moderation/report-service'
import type { NormalizedRoomInput } from '../../server/rooms/room-policy'

export type RoomProjectionResult = RoomRouteProjection | null

export const roomQueryKeys = {
  projection: (roomId: string) => ['room', 'projection', roomId] as const,
}

export function invalidateRoomProjection(
  queryClient: QueryClient,
  roomId: string,
): Promise<void> {
  const canonicalRoomId = validateRoomId(roomId)
  return queryClient.invalidateQueries({
    queryKey: roomQueryKeys.projection(canonicalRoomId),
    exact: true,
    refetchType: 'active',
  })
}

export function applyRoomProjectionRealtimeEvent(
  queryClient: QueryClient,
  roomId: string,
  value: unknown,
): Promise<void> | undefined {
  const canonicalRoomId = validateRoomId(roomId)
  const event = normalizeHomeRealtimeEvent(value)
  if (!event || !('roomId' in event) || event.roomId.toLowerCase() !== canonicalRoomId) return
  return invalidateRoomProjection(queryClient, canonicalRoomId)
}

export function roomProjectionQueryOptions(roomId: string) {
  const canonicalRoomId = validateRoomId(roomId)
  return queryOptions({
    queryKey: roomQueryKeys.projection(canonicalRoomId),
    queryFn: () => getRoomProjection({ data: canonicalRoomId }),
    staleTime: 5_000,
  })
}

export const getRoomProjection = createServerFn({ method: 'GET' })
  .validator(validateRoomId)
  .handler(async ({ data }): Promise<RoomProjectionResult> => {
    const session = await currentSession()
    return getProductionRoomService().inspectRouteProjection(data, session?.id ?? null)
  })

export const admitRoom = createServerFn({ method: 'POST' })
  .validator(validateAdmissionCommand)
  .handler(async ({ data }): Promise<AdmitResult> => {
    const session = await currentSession()
    const result = await getProductionRoomService().admit(session?.id ?? null, data.roomId, {
      password: data.password,
      confirmation: data.confirmation,
      clientIp: getRequest().headers.get('x-bhayanakcast-client-ip') ?? undefined,
    })
    if (result.status === 'joined' && session) {
      publishActivity(data.roomId, 'member-joined', session.displayName)
    }
    return result
  })

export const leaveRoom = createServerFn({ method: 'POST' })
  .validator(validateLeaveCommand)
  .handler(async ({ data }): Promise<LeaveResult> => {
    const session = await currentSession()
    if (!session) return { status: 'not-member' }
    const result = await getProductionRoomService().leave(session.id, {
      roomId: data.roomId,
      membershipId: data.membershipId,
      confirmation: data.confirmation,
    })
    if (result.status === 'left') {
      publishActivity(data.roomId, 'member-left', session.displayName)
    }
    return result
  })

function validateAdmissionCommand(value: unknown): {
  roomId: string
  password?: string
  confirmation?: MembershipConfirmation
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid admission command')
  }
  const source = value as Record<string, unknown>
  const password = source.password
  if (password !== undefined && password !== null && typeof password !== 'string') {
    throw new TypeError('Invalid password')
  }
  if (typeof password === 'string' && password.length > 512) throw new TypeError('Invalid password')
  return {
    roomId: validateRoomId(source.roomId),
    password: password as string | undefined,
    confirmation: validateConfirmation(source.confirmation),
  }
}

function validateLeaveCommand(value: unknown): {
  roomId: string
  membershipId: string
  confirmation?: MembershipConfirmation
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid leave command')
  }
  const source = value as Record<string, unknown>
  if (typeof source.membershipId !== 'string' || !ROOM_ID.test(source.membershipId)) {
    throw new TypeError('Invalid membership id')
  }
  return {
    roomId: validateRoomId(source.roomId),
    membershipId: source.membershipId,
    confirmation: validateConfirmation(source.confirmation),
  }
}

async function currentSession() {
  return readSessionProjection(getProductionAuth(), getRequest().headers)
}

/** Stream lifecycle, watch, and chat. Every one of these resolves the caller's
    own membership from the session — ADR 0104 refuses to act on a
    client-supplied membership or peer identifier. */

export const startStream = createServerFn({ method: 'POST' })
  .validator(validateRoomId)
  .handler(async ({ data }): Promise<StartStreamResult> => {
    const session = await currentSession()
    if (!session) return { status: 'not-admitted' }
    const result = await getStreamService().start(session.id, data)
    if (result.status === 'started') {
      publishActivity(result.roomId, 'stream-started', session.displayName)
    }
    return result
  })

export const stopStream = createServerFn({ method: 'POST' })
  .validator(validateStopStreamCommand)
  .handler(async ({ data }): Promise<StopStreamResult> => {
    const session = await currentSession()
    if (!session) return { status: 'not-admitted' }
    const result = await getStreamService().stop(session.id, { streamId: data.streamId })
    if (result.status === 'stopped') {
      publishActivity(result.roomId, 'stream-stopped', session.displayName)
    }
    return result
  })

export const hostStopStream = createServerFn({ method: 'POST' })
  .validator(validateHostStopStreamCommand)
  .handler(async ({ data }): Promise<HostStopStreamResult> => {
    const session = await currentSession()
    if (!session) return { status: 'not-authorized' }
    const result = await getStreamService().stopByHost(session.id, data)
    if (result.status === 'stopped') {
      publishActivity(result.roomId, 'stream-stopped', result.targetDisplayName)
    }
    return result
  })

export const watchStream = createServerFn({ method: 'POST' })
  .validator(validateWatchCommand)
  .handler(async ({ data }): Promise<SubscriptionResult> => {
    const membership = await currentMembership(data.roomId)
    if (!membership) return { status: 'viewer-not-admitted' }
    const result = await getSubscriptionService().subscribe(membership, data.streamId)
    // The watcher stack lives on the projection, so a new watch is a roster
    // change for everyone in the room (ADR 0101).
    if (result.status === 'subscribed') {
      publishRoomEvent({ type: 'membership-changed', roomId: data.roomId })
    }
    return result
  })

export const stopWatching = createServerFn({ method: 'POST' })
  .validator(validateRoomId)
  .handler(async ({ data }): Promise<{ status: 'stopped' | 'not-watching' }> => {
    const membership = await currentMembership(data)
    if (!membership) return { status: 'not-watching' }
    const closed = await getSubscriptionService().unsubscribe(membership)
    if (!closed) return { status: 'not-watching' }
    publishRoomEvent({ type: 'membership-changed', roomId: data })
    return { status: 'stopped' }
  })


export const getChatHistory = createServerFn({ method: 'GET' })
  .validator(validateRoomId)
  .handler(async ({ data }): Promise<readonly RoomChatMessage[]> => {
    const session = await currentSession()
    if (!session) return []
    const membership = await currentMembership(data)
    if (!membership) return []
    return getChatService().history(data, session.id)
  })

export function chatHistoryQueryOptions(roomId: string) {
  const canonicalRoomId = validateRoomId(roomId)
  return queryOptions({
    queryKey: ['room', 'chat', canonicalRoomId] as const,
    queryFn: () => getChatHistory({ data: canonicalRoomId }),
    // ADR 0071 backfills once on admission; live messages arrive over the
    // socket, so nothing refetches this window.
    staleTime: Number.POSITIVE_INFINITY,
  })
}

function publishActivity(
  roomId: string,
  kind: RoomActivityKind,
  displayName: string | null,
) {
  publishRoomEvent({
    type: 'activity',
    roomId,
    entry: {
      id: crypto.randomUUID(),
      kind,
      displayName,
      at: new Date().toISOString(),
    },
  })
}

async function currentMembership(roomId: string): Promise<string | null> {
  const session = await currentSession()
  if (!session) return null
  const projection = await getProductionRoomService().inspectRouteProjection(
    roomId,
    session.id,
  )
  return projection?.kind === 'admitted' ? projection.self.id : null
}

function validateStopStreamCommand(value: unknown): { streamId?: string } {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid stop stream command')
  }
  const streamId = (value as Record<string, unknown>).streamId
  if (streamId === undefined || streamId === null) return {}
  if (typeof streamId !== 'string' || !ROOM_ID.test(streamId)) {
    throw new TypeError('Invalid stream id')
  }
  return { streamId }
}

function validateHostStopStreamCommand(value: unknown): {
  roomId: string
  targetAccountId: string
  streamId: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid Host stop Stream command')
  }
  const source = value as Record<string, unknown>
  if (
    typeof source.targetAccountId !== 'string' ||
    source.targetAccountId.length > 128
  ) {
    throw new TypeError('Invalid target account id')
  }
  if (typeof source.streamId !== 'string' || !ROOM_ID.test(source.streamId)) {
    throw new TypeError('Invalid stream id')
  }
  return {
    roomId: validateRoomId(source.roomId),
    targetAccountId: source.targetAccountId,
    streamId: source.streamId,
  }
}

function validateWatchCommand(value: unknown): { roomId: string; streamId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid watch command')
  }
  const source = value as Record<string, unknown>
  if (typeof source.streamId !== 'string' || !ROOM_ID.test(source.streamId)) {
    throw new TypeError('Invalid stream id')
  }
  return { roomId: validateRoomId(source.roomId), streamId: source.streamId }
}


/** Moderation and Host Settings. */

export const submitRoomReport = createServerFn({ method: 'POST' })
  .validator(validateReportCommand)
  .handler(async ({ data }): Promise<SubmitReportResult | { status: 'unauthenticated' }> => {
    const session = await currentSession()
    if (!session) return { status: 'unauthenticated' }
    return submitReport(session.id, data)
  })

export const updateRoomSettings = createServerFn({ method: 'POST' })
  .validator(validateSettingsCommand)
  .handler(async ({ data }) => {
    const session = await currentSession()
    if (!session) return { status: 'forbidden' as const }
    return getProductionRoomService().updateRoom(session.id, data.roomId, data.input)
  })

export const listRoomBans = createServerFn({ method: 'GET' })
  .validator(validateRoomId)
  .handler(async ({ data }) => {
    const session = await currentSession()
    if (!session) return []
    return (await getProductionRoomService().listBans(session.id, data)) ?? []
  })

export const clearRoomBan = createServerFn({ method: 'POST' })
  .validator(validateBanCommand)
  .handler(async ({ data }) => {
    const session = await currentSession()
    if (!session) return { status: 'forbidden' as const }
    return getProductionRoomService().clearBan(session.id, data.roomId, data.accountId)
  })

export const banRoomMember = createServerFn({ method: 'POST' })
  .validator(validateBanCommand)
  .handler(async ({ data }) => {
    const session = await currentSession()
    if (!session) return { status: 'forbidden' as const }
    return getProductionRoomService().banAccount(session.id, data.roomId, data.accountId)
  })

export const kickRoomMember = createServerFn({ method: 'POST' })
  .validator(validateKickCommand)
  .handler(async ({ data }) => {
    const session = await currentSession()
    if (!session) return { status: 'forbidden' as const }
    return getProductionRoomService().kickAccount(session.id, data.roomId, data.accountId)
  })

export const transferRoomHost = createServerFn({ method: 'POST' })
  .validator(validateHostTransferCommand)
  .handler(async ({ data }) => {
    const session = await currentSession()
    if (!session) return { status: 'forbidden' as const }
    return getProductionRoomService().transferHost(
      session.id,
      data.roomId,
      data.accountId,
    )
  })

export function roomBansQueryOptions(roomId: string) {
  const canonicalRoomId = validateRoomId(roomId)
  return queryOptions({
    queryKey: ['room', 'bans', canonicalRoomId] as const,
    queryFn: () => listRoomBans({ data: canonicalRoomId }),
  })
}

function validateReportCommand(value: unknown): {
  targetType: ReportTargetType
  targetId: string
  roomId: string | null
  reason: ReportReason
  details: string | null
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid report')
  }
  const source = value as Record<string, unknown>
  if (
    source.targetType !== 'account' &&
    source.targetType !== 'room' &&
    source.targetType !== 'stream' &&
    source.targetType !== 'message'
  ) {
    throw new TypeError('Invalid report target')
  }
  if (typeof source.targetId !== 'string' || source.targetId.length > 128) {
    throw new TypeError('Invalid report target')
  }
  if (!REPORT_REASONS.includes(source.reason as ReportReason)) {
    throw new TypeError('Invalid report reason')
  }
  const details = source.details
  if (details !== null && details !== undefined && typeof details !== 'string') {
    throw new TypeError('Invalid report details')
  }
  return {
    targetType: source.targetType,
    targetId: source.targetId,
    roomId: source.roomId === null || source.roomId === undefined
      ? null
      : validateRoomId(source.roomId),
    reason: source.reason as ReportReason,
    details: typeof details === 'string' ? details.slice(0, 2_000) : null,
  }
}

function validateSettingsCommand(value: unknown): {
  roomId: string
  input: NormalizedRoomInput
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid room settings')
  }
  const source = value as Record<string, unknown>
  return {
    roomId: validateRoomId(source.roomId),
    input: validateCreateRoomInput(source.input),
  }
}

function validateBanCommand(value: unknown): { roomId: string; accountId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid ban command')
  }
  const source = value as Record<string, unknown>
  if (typeof source.accountId !== 'string' || source.accountId.length > 128) {
    throw new TypeError('Invalid account id')
  }
  return { roomId: validateRoomId(source.roomId), accountId: source.accountId }
}

function validateKickCommand(value: unknown): { roomId: string; accountId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid kick command')
  }
  const source = value as Record<string, unknown>
  if (typeof source.accountId !== 'string' || source.accountId.length > 128) {
    throw new TypeError('Invalid account id')
  }
  return { roomId: validateRoomId(source.roomId), accountId: source.accountId }
}

function validateHostTransferCommand(
  value: unknown,
): { roomId: string; accountId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid Host transfer command')
  }
  const source = value as Record<string, unknown>
  if (typeof source.accountId !== 'string' || source.accountId.length > 128) {
    throw new TypeError('Invalid account id')
  }
  return { roomId: validateRoomId(source.roomId), accountId: source.accountId }
}
