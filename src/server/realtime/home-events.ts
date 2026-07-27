import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type {
  ActiveRoomSummary,
  ConnectedPresence,
  StreamPreview,
} from '../../features/home/home-types'

export const HOME_SOCKET_EVENT = 'home:event' as const
export const HOME_ACCOUNT_REVOKED_EVENT = 'home:account-revoked' as const
export const HOME_ACCOUNT_REPLACED_EVENT = 'home:account-replaced' as const

const HOME_QUERY_PREFIX = ['home'] as const
const HOME_ROOMS_PREFIX = ['home', 'rooms'] as const
const HOME_PAST_STREAMS_KEY = ['home', 'past-streams'] as const
const HOME_FACETS_KEY = ['home', 'facets'] as const
const HOME_STATISTICS_PREFIX = ['home', 'statistics'] as const
const MAX_ID_LENGTH = 128
const MAX_PREVIEW_KEY_LENGTH = 512
const MAX_TIMESTAMP_LENGTH = 64
const MAX_ROOM_COUNT = 10

export interface HomeRoomValuePatch {
  readonly type: 'room-value'
  readonly roomId: string
  readonly memberCount?: number
  readonly streamCount?: number
  readonly state?: ActiveRoomSummary['state']
  readonly preview?: StreamPreview | null
}

export interface HomeRoomMembershipEvent {
  readonly type: 'room-membership'
  readonly roomId: string
  readonly memberCount: number
  readonly streamCount: number
  readonly state?: ActiveRoomSummary['state']
}

export interface HomeRoomEndedEvent {
  readonly type: 'room-ended'
  readonly roomId: string
}


export interface HomeRoomWarningEvent {
  readonly type: 'room-warning'
  readonly roomId: string
  readonly minutes: 30 | 10 | 1
}
export interface HomeRoomDiscoveryEvent {
  readonly type: 'room-discovery'
  readonly roomId: string
}

export interface HomePresenceEvent {
  readonly type: 'presence'
  readonly connectedAccountCount: number
}
export type HomeEventPublisher = (event: HomeRealtimeEvent) => void

export type HomeRealtimeEvent =
  | HomeRoomValuePatch
  | HomeRoomMembershipEvent
  | HomeRoomEndedEvent
  | HomeRoomWarningEvent
  | HomeRoomDiscoveryEvent
  | HomePresenceEvent

type HomeEventListener = (event: HomeRealtimeEvent) => void

export interface HomeEventHub {
  publish(event: unknown): void
  subscribe(listener: HomeEventListener): () => void
}

export function createHomeEventHub(): HomeEventHub {
  const listeners = new Set<HomeEventListener>()
  return {
    publish(value) {
      const event = normalizeHomeRealtimeEvent(value)
      if (!event) return
      for (const listener of [...listeners]) {
        try {
          listener(event)
        } catch {
          // One failing subscriber must not abort committed producer work.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function normalizeHomeRealtimeEvent(value: unknown): HomeRealtimeEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  const roomId = boundedString(value.roomId, MAX_ID_LENGTH)
  if (value.type === 'presence') {
    const connectedAccountCount = boundedPresenceCount(value.connectedAccountCount)
    return connectedAccountCount === null
      ? null
      : { type: 'presence', connectedAccountCount }
  }
  if (!roomId) return null

  if (value.type === 'room-warning') {
    if (value.minutes !== 30 && value.minutes !== 10 && value.minutes !== 1) return null
    return { type: 'room-warning', roomId, minutes: value.minutes }
  }
  if (value.type === 'room-ended' || value.type === 'room-discovery') {
    return { type: value.type, roomId }
  }

  if (value.type === 'room-membership') {
    const memberCount = boundedCount(value.memberCount)
    const streamCount = boundedCount(value.streamCount)
    if (memberCount === null || streamCount === null) return null
    const state = boundedState(value.state)
    return state ? { type: value.type, roomId, memberCount, streamCount, state } : {
      type: value.type,
      roomId,
      memberCount,
      streamCount,
    }
  }

  if (value.type !== 'room-value') return null
  const memberCount = optionalCount(value.memberCount)
  const streamCount = optionalCount(value.streamCount)
  if (memberCount === invalid || streamCount === invalid) return null
  const state = value.state === undefined ? undefined : boundedState(value.state)
  if (value.state !== undefined && !state) return null
  const preview = value.preview === undefined ? undefined : normalizePreview(value.preview)
  if (preview === invalid) return null
  const safePreview = preview as StreamPreview | null | undefined
  if (memberCount === undefined && streamCount === undefined && state === undefined && safePreview === undefined) {
    return null
  }
  return {
    type: 'room-value',
    roomId,
    ...(memberCount !== undefined ? { memberCount } : {}),
    ...(streamCount !== undefined ? { streamCount } : {}),
    ...(state ? { state } : {}),
    ...(safePreview !== undefined ? { preview: safePreview } : {}),
  }
}

export function applyHomeRealtimeEvent(
  queryClient: QueryClient,
  event: HomeRealtimeEvent,
): void {
  if (event.type === 'presence') {
    queryClient.setQueriesData<ConnectedPresence>(
      { queryKey: ['home', 'presence'] },
      (presence) =>
        presence
          ? { connectedAccountCount: event.connectedAccountCount }
          : undefined,
    )
    return
  }
  if (event.type === 'room-value' || event.type === 'room-membership') {
    queryClient.setQueriesData<readonly ActiveRoomSummary[]>(
      { queryKey: HOME_ROOMS_PREFIX },
      (rooms) => patchRoom(rooms, event),
    )
  }

  if (event.type === 'room-value') return

  if (event.type === 'room-ended') {
    queryClient.setQueriesData<readonly ActiveRoomSummary[]>(
      { queryKey: HOME_ROOMS_PREFIX },
      (rooms) => rooms?.filter((room) => room.id !== event.roomId),
    )
    invalidate(queryClient, HOME_ROOMS_PREFIX)
    invalidate(queryClient, HOME_PAST_STREAMS_KEY)
    invalidate(queryClient, HOME_FACETS_KEY)
    invalidate(queryClient, HOME_STATISTICS_PREFIX)
    return
  }

  if (event.type === 'room-membership') {
    invalidate(queryClient, HOME_ROOMS_PREFIX)
    invalidate(queryClient, HOME_STATISTICS_PREFIX)
    return
  }

  invalidate(queryClient, HOME_ROOMS_PREFIX)
  invalidate(queryClient, HOME_FACETS_KEY)
  invalidate(queryClient, HOME_STATISTICS_PREFIX)
}

function patchRoom(
  rooms: readonly ActiveRoomSummary[] | undefined,
  event: HomeRoomValuePatch | HomeRoomMembershipEvent,
): readonly ActiveRoomSummary[] | undefined {
  if (!rooms) return undefined
  return rooms.map((room) => {
    if (room.id !== event.roomId) return room
    const previewPatch =
      event.type === 'room-value' && event.preview !== undefined
        ? event.preview
          ? [
              event.preview,
              ...room.previews.filter(
                (preview) => preview.previewKey !== event.preview?.previewKey,
              ),
            ].slice(0, 4)
          : []
        : undefined
    return {
      ...room,
      ...(event.memberCount !== undefined ? { memberCount: event.memberCount } : {}),
      ...(event.streamCount !== undefined ? { streamCount: event.streamCount } : {}),
      ...(event.state !== undefined ? { state: event.state } : {}),
      ...(previewPatch !== undefined ? { previews: previewPatch } : {}),
    }
  })
}

function invalidate(queryClient: QueryClient, queryKey: QueryKey) {
  void queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
}

const invalid = Symbol('invalid')

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null
}

function boundedCount(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= MAX_ROOM_COUNT
    ? Number(value)
    : null
}

function boundedPresenceCount(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000
    ? Number(value)
    : null
}
function optionalCount(value: unknown): number | undefined | typeof invalid {
  if (value === undefined) return undefined
  const count = boundedCount(value)
  return count === null ? invalid : count
}

function boundedState(value: unknown): ActiveRoomSummary['state'] | null {
  return value === 'live' || value === 'full' ? value : null
}

function normalizePreview(value: unknown): StreamPreview | null | typeof invalid {
  if (value === null) return null
  if (!isRecord(value)) return invalid
  const previewKey = boundedString(value.previewKey, MAX_PREVIEW_KEY_LENGTH)
  const updatedAt = boundedString(value.updatedAt, MAX_TIMESTAMP_LENGTH)
  return previewKey && updatedAt ? { previewKey, updatedAt } : invalid
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
