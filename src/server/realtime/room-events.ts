/** Room-scoped realtime protocol.

    ADR 0030 keeps the realtime protocol internal, so the shape is ours; this
    mirrors `home-events.ts` — a discriminated union plus a `normalize…`
    validator that every inbound payload passes through before it is trusted.

    Unlike Home events, these carry member identity and message content, so they
    fan out to the room's admitted members only (ADR 0003). */

export const ROOM_SOCKET_EVENT = 'room:event' as const
export const ROOM_JOIN_COMMAND = 'room:join' as const
export const ROOM_LEAVE_COMMAND = 'room:leave' as const
export const ROOM_SIGNAL_COMMAND = 'room:signal' as const
export const ROOM_TYPING_COMMAND = 'room:typing' as const

const MAX_ID_LENGTH = 128
const MAX_NAME_LENGTH = 256
/** ADR 0102's composer limit. It lives here because the client needs it and a
    component must not import the chat service to get at a number. */
export const CHAT_BODY_LIMIT = 500
const MAX_BODY_LENGTH = CHAT_BODY_LIMIT
const MAX_TIMESTAMP_LENGTH = 64
/** SDP blobs are large; candidates are small. One bound covers both without
    letting a client push unbounded text through the server. */
const MAX_SIGNAL_PAYLOAD_LENGTH = 64_000

export interface RoomChatMessage {
  readonly id: string
  readonly roomId: string
  readonly membershipId: string
  readonly accountId: string
  readonly displayName: string
  readonly avatarUrl: string | null
  readonly body: string
  readonly createdAt: string
  /** Echoed back from the sender's optimistic bubble so the client can replace
      its pending message rather than showing it twice (ADR 0102). */
  readonly mutationId: string | null
}

export type RoomActivityKind =
  | 'member-joined'
  | 'member-left'
  | 'stream-started'
  | 'stream-stopped'
  | 'host-transferred'
  | 'member-removed'
  | 'room-warning'

export interface RoomActivityEntry {
  readonly id: string
  readonly kind: RoomActivityKind
  readonly displayName: string | null
  readonly at: string
  /** Only ever the warning's minute mark. ADR 0103 forbids exposing
      enforcement detail, so no reason text travels on an activity entry. */
  readonly minutes?: 30 | 10 | 1
}

export interface RoomMembershipChangedEvent {
  readonly type: 'membership-changed'
  readonly roomId: string
}

export interface RoomStreamStartedEvent {
  readonly type: 'stream-started'
  readonly roomId: string
  readonly streamId: string
  readonly membershipId: string
}

export interface RoomStreamStoppedEvent {
  readonly type: 'stream-stopped'
  readonly roomId: string
  readonly streamId: string
  readonly membershipId: string
}

/** A fresher Stream Preview is available (ADR 0035). Carries the key rather
    than the bytes: the tile fetches the image over the thumbnail path, and
    preview bytes never travel on the realtime channel. */
export interface RoomStreamPreviewEvent {
  readonly type: 'stream-preview'
  readonly roomId: string
  readonly streamId: string
  readonly previewKey: string
  readonly updatedAt: string
}

export interface RoomChatEvent {
  readonly type: 'chat-message'
  readonly roomId: string
  readonly message: RoomChatMessage
}

export interface RoomTypingEvent {
  readonly type: 'typing'
  readonly roomId: string
  readonly membershipId: string
  readonly accountId: string
  readonly displayName: string
  /** `false` retires the indicator immediately on blur, send, or empty input;
      otherwise the client expires it five seconds after the last refresh. */
  readonly typing: boolean
}

export interface RoomActivityEvent {
  readonly type: 'activity'
  readonly roomId: string
  readonly entry: RoomActivityEntry
}

export interface RoomEndedEvent {
  readonly type: 'room-ended'
  readonly roomId: string
}

export interface RoomSignalEvent {
  readonly type: 'signal'
  readonly roomId: string
  readonly streamId: string
  /** The subscription this negotiation belongs to — ADR 0104 models one
      `RTCPeerConnection` per directed subscription and identifies it by an
      opaque application record, never a user-supplied peer id. */
  readonly subscriptionId: string
  readonly signal: RoomSignalPayload
}

export type RoomSignalPayload =
  | { readonly kind: 'offer'; readonly sdp: string }
  | { readonly kind: 'answer'; readonly sdp: string }
  | { readonly kind: 'candidate'; readonly candidate: string; readonly sdpMid: string | null; readonly sdpMLineIndex: number | null }
  | { readonly kind: 'close' }

export type RoomRealtimeEvent =
  | RoomMembershipChangedEvent
  | RoomStreamStartedEvent
  | RoomStreamStoppedEvent
  | RoomStreamPreviewEvent
  | RoomChatEvent
  | RoomTypingEvent
  | RoomActivityEvent
  | RoomEndedEvent
  | RoomSignalEvent

export type RoomEventPublisher = (event: RoomRealtimeEvent) => void

export function normalizeRoomRealtimeEvent(value: unknown): RoomRealtimeEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  const roomId = boundedString(value.roomId, MAX_ID_LENGTH)
  if (!roomId) return null

  switch (value.type) {
    case 'membership-changed':
    case 'room-ended':
      return { type: value.type, roomId }

    case 'stream-started':
    case 'stream-stopped': {
      const streamId = boundedString(value.streamId, MAX_ID_LENGTH)
      const membershipId = boundedString(value.membershipId, MAX_ID_LENGTH)
      if (!streamId || !membershipId) return null
      return { type: value.type, roomId, streamId, membershipId }
    }

    case 'stream-preview': {
      const streamId = boundedString(value.streamId, MAX_ID_LENGTH)
      const previewKey = boundedString(value.previewKey, MAX_ID_LENGTH)
      const updatedAt = boundedString(value.updatedAt, MAX_TIMESTAMP_LENGTH)
      if (!streamId || !previewKey || !updatedAt) return null
      return { type: 'stream-preview', roomId, streamId, previewKey, updatedAt }
    }

    case 'chat-message': {
      const message = normalizeChatMessage(value.message)
      return message ? { type: 'chat-message', roomId, message } : null
    }

    case 'typing': {
      const membershipId = boundedString(value.membershipId, MAX_ID_LENGTH)
      const accountId = boundedString(value.accountId, MAX_ID_LENGTH)
      const displayName = boundedString(value.displayName, MAX_NAME_LENGTH)
      if (!membershipId || !accountId || !displayName) return null
      if (typeof value.typing !== 'boolean') return null
      return {
        type: 'typing',
        roomId,
        membershipId,
        accountId,
        displayName,
        typing: value.typing,
      }
    }

    case 'activity': {
      const entry = normalizeActivityEntry(value.entry)
      return entry ? { type: 'activity', roomId, entry } : null
    }

    case 'signal': {
      const streamId = boundedString(value.streamId, MAX_ID_LENGTH)
      const subscriptionId = boundedString(value.subscriptionId, MAX_ID_LENGTH)
      const signal = normalizeSignalPayload(value.signal)
      if (!streamId || !subscriptionId || !signal) return null
      return { type: 'signal', roomId, streamId, subscriptionId, signal }
    }

    default:
      return null
  }
}

export function normalizeSignalPayload(value: unknown): RoomSignalPayload | null {
  if (!isRecord(value)) return null
  if (value.kind === 'close') return { kind: 'close' }
  if (value.kind === 'offer' || value.kind === 'answer') {
    const sdp = boundedString(value.sdp, MAX_SIGNAL_PAYLOAD_LENGTH)
    return sdp ? { kind: value.kind, sdp } : null
  }
  if (value.kind !== 'candidate') return null
  const candidate = boundedString(value.candidate, MAX_SIGNAL_PAYLOAD_LENGTH)
  if (!candidate) return null
  const sdpMid = value.sdpMid === null ? null : boundedString(value.sdpMid, MAX_ID_LENGTH)
  const sdpMLineIndex =
    value.sdpMLineIndex === null
      ? null
      : Number.isInteger(value.sdpMLineIndex) && Number(value.sdpMLineIndex) >= 0
        ? Number(value.sdpMLineIndex)
        : undefined
  if (sdpMLineIndex === undefined) return null
  return { kind: 'candidate', candidate, sdpMid: sdpMid ?? null, sdpMLineIndex }
}

function normalizeChatMessage(value: unknown): RoomChatMessage | null {
  if (!isRecord(value)) return null
  const id = boundedString(value.id, MAX_ID_LENGTH)
  const roomId = boundedString(value.roomId, MAX_ID_LENGTH)
  const membershipId = boundedString(value.membershipId, MAX_ID_LENGTH)
  const accountId = boundedString(value.accountId, MAX_ID_LENGTH)
  const displayName = boundedString(value.displayName, MAX_NAME_LENGTH)
  const body = boundedString(value.body, MAX_BODY_LENGTH)
  const createdAt = boundedString(value.createdAt, MAX_TIMESTAMP_LENGTH)
  if (!id || !roomId || !membershipId || !accountId || !displayName || !body || !createdAt) {
    return null
  }
  const avatarUrl =
    value.avatarUrl === null || value.avatarUrl === undefined
      ? null
      : boundedString(value.avatarUrl, MAX_SIGNAL_PAYLOAD_LENGTH)
  const mutationId =
    value.mutationId === null || value.mutationId === undefined
      ? null
      : boundedString(value.mutationId, MAX_ID_LENGTH)
  return {
    id,
    roomId,
    membershipId,
    accountId,
    displayName,
    avatarUrl: avatarUrl ?? null,
    body,
    createdAt,
    mutationId: mutationId ?? null,
  }
}

function normalizeActivityEntry(value: unknown): RoomActivityEntry | null {
  if (!isRecord(value)) return null
  const id = boundedString(value.id, MAX_ID_LENGTH)
  const at = boundedString(value.at, MAX_TIMESTAMP_LENGTH)
  if (!id || !at || !isActivityKind(value.kind)) return null
  const displayName =
    value.displayName === null || value.displayName === undefined
      ? null
      : boundedString(value.displayName, MAX_NAME_LENGTH)
  if (value.kind === 'room-warning') {
    if (value.minutes !== 30 && value.minutes !== 10 && value.minutes !== 1) return null
    return { id, kind: value.kind, displayName: displayName ?? null, at, minutes: value.minutes }
  }
  return { id, kind: value.kind, displayName: displayName ?? null, at }
}

function isActivityKind(value: unknown): value is RoomActivityKind {
  return (
    value === 'member-joined' ||
    value === 'member-left' ||
    value === 'stream-started' ||
    value === 'stream-stopped' ||
    value === 'host-transferred' ||
    value === 'member-removed' ||
    value === 'room-warning'
  )
}

/** Fan-out hub. Listeners register per room so an event never reaches a socket
    outside the room it belongs to. */
export interface RoomEventHub {
  publish(event: unknown): void
  subscribe(roomId: string, listener: (event: RoomRealtimeEvent) => void): () => void
}

export function createRoomEventHub(): RoomEventHub {
  const listeners = new Map<string, Set<(event: RoomRealtimeEvent) => void>>()
  return {
    publish(value) {
      const event = normalizeRoomRealtimeEvent(value)
      if (!event) return
      const room = listeners.get(event.roomId)
      if (!room) return
      for (const listener of [...room]) {
        try {
          listener(event)
        } catch {
          // One failing subscriber must not abort committed producer work.
        }
      }
    },
    subscribe(roomId, listener) {
      const room = listeners.get(roomId) ?? new Set()
      room.add(listener)
      listeners.set(roomId, room)
      return () => {
        room.delete(listener)
        if (room.size === 0) listeners.delete(roomId)
      }
    },
  }
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
