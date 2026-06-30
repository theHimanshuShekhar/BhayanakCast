# Socket.IO Event Catalog

Socket.IO is the realtime coordination boundary for BhayanakCast. It carries room coordination, chat, moderation commands, thumbnail preview uploads, and room-scoped WebRTC signaling. It does not carry live stream audio/video.

## Conventions

- Event names use `domain:action`.
- Payload fields use `camelCase`.
- IDs are opaque non-empty strings.
- Client commands use Socket.IO ack callbacks for correlation; payloads do not include `requestId`.
- Command ack shape:

```ts
type Ack<T = void> =
  | { ok: true; data?: T }
  | { ok: false; code: SocketErrorCode; message: string }
```

- Broadcasts send small canonical DTO snapshots rather than minimal deltas.
- Internal Socket.IO room names are prefixed: `room:{roomId}` for room membership and `discovery` for live discovery/admin lists.
- Every command payload is validated with Zod before side effects.

## Current implementation coverage

The current server registers the implemented V1 subset below. The broader protocol sections remain the target contract for follow-up lifecycle, moderation, thumbnail, and admin work tracked in `AUDIT.md`.

Implemented client commands:

- `room:join`
- `chat:send`
- `stream:start`
- `stream:stop`
- `signal:offer`
- `signal:answer`
- `signal:iceCandidate`

Implemented server broadcasts:

- `site:presence`
- `member:joined`
- `chat:message`
- `stream:started`
- `stream:stopped`
- `signal:offer`
- `signal:answer`
- `signal:iceCandidate`

Not yet implemented from this catalog:

- `system:ready`, `discovery:*`, `room:leave`, room lifecycle broadcasts, watch commands, `stream:thumbnail`, `stream:thumbnailUpdated`, `signal:failed`, host moderation commands, report commands, and admin commands.

`site:presence` is implemented as a site-wide broadcast outside room membership. It reports `{ connectedUsers: number }`, where connected users are deduped by authenticated account ID or anonymous browser `visitorId`; multiple tabs in one browser count once.

## Shared DTOs

```ts
type UserSummary = {
  userId: string
  displayName: string
  avatarUrl?: string
  isPlatformAdmin?: boolean
}

type RoomState = 'live' | 'empty_grace' | 'ended'
type RoomVisibility = 'public' | 'private'

type RoomSummary = {
  roomId: string
  name: string
  category: string
  tags: string[]
  visibility: RoomVisibility
  state: RoomState
  memberCount: number
  capacity: 10
  activeStreamCount: number
  currentHostUserId: string
  createdByUserId: string
  createdAt: string
  updatedAt: string
  endedAt?: string
  isPrivate: boolean
  hidesParticipantIdentities: boolean
}

type RoomMember = {
  membershipId: string
  roomId: string
  user: UserSummary
  joinedAt: string
  isHost: boolean
  isStreaming: boolean
  reconnectGraceEndsAt?: string
}

type StreamSummary = {
  streamSessionId: string
  roomId: string
  user: UserSummary
  startedAt: string
  hasVideo: boolean
  hasAudio: boolean
  displaySurface?: string
  label?: string
  thumbnailUpdatedAt?: string
}

type ChatMessage = {
  messageId: string
  roomId: string
  user: UserSummary
  body: string
  createdAt: string
}

type ReportSummary = {
  reportId: string
  reporterUserId: string
  targetType: 'account' | 'room' | 'stream_session' | 'chat_message'
  targetId: string
  roomId?: string
  reason: string
  details?: string
  createdAt: string
  resolvedAt?: string
  hasThumbnailSnapshot: boolean
}

type PlatformSanctionType =
  | 'stream_ban'
  | 'chat_ban'
  | 'room_creation_ban'
  | 'full_suspension'

type PlatformSanction = {
  sanctionId: string
  userId: string
  type: PlatformSanctionType
  reason: string
  createdByUserId: string
  startsAt: string
  expiresAt?: string
  liftedAt?: string
}
```

## Error codes

These codes are stable API surface. UI branches on `code`; `message` is a fallback string.

```ts
type SocketErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'ROOM_NOT_LIVE'
  | 'ROOM_FULL'
  | 'ALREADY_IN_ROOM'
  | 'NOT_IN_ROOM'
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'ROOM_BANNED'
  | 'FULLY_SUSPENDED'
  | 'CHAT_BANNED'
  | 'STREAM_BANNED'
  | 'ROOM_CREATION_BANNED'
  | 'NOT_HOST'
  | 'NOT_PLATFORM_ADMIN'
  | 'STREAM_NOT_ACTIVE'
  | 'STREAM_ALREADY_ACTIVE'
  | 'TARGET_NOT_IN_ROOM'
  | 'TARGET_SOCKET_NOT_FOUND'
  | 'THUMBNAIL_TOO_LARGE'
  | 'UNSUPPORTED_BROWSER'
  | 'CONNECTION_FAILED'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
```

## Connection lifecycle

### `system:ready`

Direction: server → client, after connection auth/session is known.

Payload:

```ts
{
  user: UserSummary
  socketId: string
  serverTime: string
}
```

### `system:error`

Direction: server → client, for non-command asynchronous errors.

Payload:

```ts
{
  code: SocketErrorCode
  message: string
}
```

## Discovery events

### `discovery:join`

Direction: client → server command.

Payload: `{}`

Ack data:

```ts
{
  rooms: RoomSummary[]
}
```

Server side effect: joins internal Socket.IO room `discovery`.

Errors: `UNAUTHENTICATED`, `FULLY_SUSPENDED`, `INTERNAL_ERROR`.

### `discovery:leave`

Direction: client → server command.

Payload: `{}`

Ack data: none.

Server side effect: leaves internal Socket.IO room `discovery`.

### `discovery:roomCreated`

Direction: server → `discovery` broadcast.

Payload:

```ts
{
  room: RoomSummary
}
```

### `discovery:roomUpdated`

Direction: server → `discovery` broadcast.

Payload:

```ts
{
  room: RoomSummary
}
```

### `discovery:roomRevived`

Direction: server → `discovery` broadcast.

Payload:

```ts
{
  room: RoomSummary
}
```

### `discovery:roomEnded`

Direction: server → `discovery` broadcast.

Payload:

```ts
{
  room: RoomSummary
}
```

## Room commands and broadcasts

### `room:create`

Direction: client → server command.

Payload:

```ts
{
  name: string
  category: string
  tags: string[]
  visibility: 'public' | 'private'
  password?: string
}
```

Ack data:

```ts
{
  room: RoomSummary
}
```

Validation:

- `name`: 3–80 characters.
- `tags`: max 5; each max 24 characters.
- `password` required when `visibility = 'private'`.

Errors: `UNAUTHENTICATED`, `FULLY_SUSPENDED`, `ROOM_CREATION_BANNED`, `VALIDATION_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`.

Broadcasts: `discovery:roomCreated`.

### `room:join`

Direction: client → server command.

Payload:

{
  roomId: string
  password?: string
  takeover?: boolean
}
```

Ack data:

```ts
{
  room: RoomSummary
  members: RoomMember[]
  streams: StreamSummary[]
  recentMessages: ChatMessage[]
}
```

Duplicate active client ack:

```ts
{
  ok: false
  code: 'CONFLICT'
  message: string
  data: { reason: 'ACTIVE_ROOM_CLIENT' }
}
```

Server validation order:

1. Better Auth session.
2. Full-account suspension.
3. Room exists and is `live` or `empty_grace`.
4. Effective room ban.
5. Private-room password.
6. Capacity or reconnect slot.

Server side effects:

- Joins internal Socket.IO room `room:{roomId}`.
- If room was `empty_grace`, sets state to `live`, assigns joiner as host, and emits `room:revived`, `host:changed`, `member:joined`.
- If account already has another active socket in this room and `takeover` is not true, returns `CONFLICT` with `reason: 'ACTIVE_ROOM_CLIENT'` and does not join the new socket. If `takeover` is true, old room sockets for that account and room are replaced, old streams stop, old subscriptions drop, and old clients route home.

Errors: `UNAUTHENTICATED`, `FULLY_SUSPENDED`, `NOT_FOUND`, `ROOM_NOT_LIVE`, `ROOM_BANNED`, `PASSWORD_REQUIRED`, `INVALID_PASSWORD`, `ROOM_FULL`, `RATE_LIMITED`, `CONFLICT`, `INTERNAL_ERROR`.

Broadcasts: `member:joined`, optionally `room:revived`, `host:changed`, `stream:stopped` for replaced socket streams.

### `room:leave`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
}
```

Ack data: none.

Server side effects:

- Leaves internal Socket.IO room `room:{roomId}`.
- Ends active streams owned by the socket.
- Starts host handoff if needed.
- Starts empty-room grace if last member leaves.

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `INTERNAL_ERROR`.

Broadcasts: `member:left`, `stream:stopped`, optionally `host:changed`, `room:emptyGraceStarted`.

### `room:snapshot`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
}
```

Ack data:

```ts
{
  room: RoomSummary
  members: RoomMember[]
  streams: StreamSummary[]
}
```

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `NOT_FOUND`, `INTERNAL_ERROR`.

### `room:revived`

Direction: server → room and discovery broadcast.

Payload:

```ts
{
  room: RoomSummary
}
```

### `room:emptyGraceStarted`

Direction: server → room and discovery broadcast.

Payload:

```ts
{
  room: RoomSummary
  emptyGraceEndsAt: string
}
```

### `room:ended`

Direction: server → room and discovery broadcast.

Payload:

```ts
{
  room: RoomSummary
}
```

## Member and host broadcasts

### `member:joined`

Direction: server → room broadcast.

Payload:

```ts
{
  room: RoomSummary
  member: RoomMember
}
```

### `member:left`

Direction: server → room broadcast.

Payload:

```ts
{
  room: RoomSummary
  userId: string
  leftAt: string
}
```

### `member:reconnectGraceStarted`

Direction: server → room broadcast.

Payload:

```ts
{
  userId: string
  reconnectGraceEndsAt: string
}
```

### `member:reconnected`

Direction: server → room broadcast.

Payload:

```ts
{
  member: RoomMember
}
```

### `host:changed`

Direction: server → room broadcast.

Payload:

```ts
{
  room: RoomSummary
  previousHostUserId?: string
  currentHostUserId: string
}
```

## Chat events

### `chat:send`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  body: string
}
```

Ack data:

```ts
{
  message: ChatMessage
}
```

Server behavior: validate, persist, then broadcast canonical persisted message.

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `CHAT_BANNED`, `VALIDATION_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`.

Broadcasts: `chat:message`.

### `chat:message`

Direction: server → room broadcast.

Payload:

```ts
{
  message: ChatMessage
}
```

## Stream events

### `stream:start`

Direction: client → server command.

Precondition: browser `getDisplayMedia` already succeeded.

Payload:

```ts
{
  roomId: string
  hasVideo: boolean
  hasAudio: boolean
  displaySurface?: string
  label?: string
}
```

Ack data:

```ts
{
  stream: StreamSummary
}
```

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `STREAM_BANNED`, `UNSUPPORTED_BROWSER`, `STREAM_ALREADY_ACTIVE`, `VALIDATION_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`.

Broadcasts: `stream:started`, `discovery:roomUpdated`.

### `stream:stop`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  streamSessionId: string
}
```

Ack data: none.

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `STREAM_NOT_ACTIVE`, `RATE_LIMITED`, `INTERNAL_ERROR`.

Broadcasts: `stream:stopped`, `discovery:roomUpdated`.

### `stream:started`

Direction: server → room broadcast.

Payload:

```ts
{
  room: RoomSummary
  stream: StreamSummary
}
```

### `stream:stopped`

Direction: server → room broadcast.

Payload:

```ts
{
  room: RoomSummary
  streamSessionId: string
  userId: string
  stoppedAt: string
  reason: 'self' | 'host' | 'disconnect' | 'socket_replaced' | 'room_ended'
}
```

Clients close related peer connections and return subscribed tiles to stopped/preview state as appropriate.

### `stream:thumbnail`

Direction: client → server command with binary payload.

Payload:

```ts
{
  roomId: string
  streamSessionId: string
  contentType: 'image/webp' | 'image/jpeg'
  byteLength: number
  data: ArrayBuffer
}
```

Ack data:

```ts
{
  thumbnailUpdatedAt: string
}
```

Validation:

- Max 100 KB.
- Rate limit: one upload every 110 seconds per stream session.
- Stream must be active and owned by socket user.

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `STREAM_NOT_ACTIVE`, `FORBIDDEN`, `THUMBNAIL_TOO_LARGE`, `RATE_LIMITED`, `VALIDATION_FAILED`, `INTERNAL_ERROR`.

Broadcasts: `stream:thumbnailUpdated`.

### `stream:thumbnailUpdated`

Direction: server → room broadcast.

Payload:

```ts
{
  streamSessionId: string
  thumbnailUpdatedAt: string
}
```

The thumbnail bytes are fetched/rendered through the implementation's preview mechanism; live media is not subscribed automatically.

## Watch/subscription events

Stream subscriptions are live-only Socket.IO/WebRTC state and are not persisted.

### `watch:start`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  streamSessionId: string
}
```

Ack data:

```ts
{
  stream: StreamSummary
  streamerSocketId: string
}
```

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `STREAM_NOT_ACTIVE`, `TARGET_SOCKET_NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`.

After success, viewer starts room-scoped WebRTC signaling. Client retries connection setup 3 times over 15 seconds before showing `CONNECTION_FAILED` UI with manual Retry.

### `watch:stop`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  streamSessionId: string
}
```

Ack data: none.

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `STREAM_NOT_ACTIVE`, `INTERNAL_ERROR`.

## WebRTC signaling events

These events relay signaling only. They must not be blanket-rate-limited in a way that breaks connection setup.

### `signal:offer`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  streamSessionId: string
  targetSocketId: string
  description: unknown
}
```

Ack data: none.

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `STREAM_NOT_ACTIVE`, `TARGET_SOCKET_NOT_FOUND`, `TARGET_NOT_IN_ROOM`, `FORBIDDEN`, `INTERNAL_ERROR`.

Broadcast/relay: `signal:offer` server → target socket with same payload plus `fromSocketId` and `fromUserId`.

### `signal:answer`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  streamSessionId: string
  targetSocketId: string
  description: unknown
}
```

Ack data: none.

Errors: same as `signal:offer`.

Broadcast/relay: `signal:answer` server → target socket with same payload plus `fromSocketId` and `fromUserId`.

### `signal:iceCandidate`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  streamSessionId: string
  targetSocketId: string
  candidate: unknown
}
```

Ack data: none.

Errors: same as `signal:offer`.

Broadcast/relay: `signal:iceCandidate` server → target socket with same payload plus `fromSocketId` and `fromUserId`.

### `signal:failed`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  streamSessionId: string
  reason: 'timeout' | 'ice_failed' | 'peer_closed' | 'unknown'
}
```

Ack data: none.

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `STREAM_NOT_ACTIVE`, `INTERNAL_ERROR`.

Server behavior: logs structured failure event. It does not stop the stream.

## Host moderation events

### `host:stopStream`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  streamSessionId: string
}
```

Ack data: none.

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `NOT_HOST`, `STREAM_NOT_ACTIVE`, `RATE_LIMITED`, `INTERNAL_ERROR`.

Broadcasts: `stream:stopped` with `reason: 'host'`.

### `host:banMember`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  targetUserId: string
  reason?: string
}
```

Ack data:

```ts
{
  bannedUserId: string
}
```

Server behavior: creates `room_bans` row, removes target from room, stops their active streams.

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `NOT_HOST`, `TARGET_NOT_IN_ROOM`, `VALIDATION_FAILED`, `INTERNAL_ERROR`.

Broadcasts: `member:banned`, `member:left`, `stream:stopped` as needed.

### `host:clearBan`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  targetUserId: string
}
```

Ack data:

```ts
{
  clearedUserId: string
}
```

Errors: `UNAUTHENTICATED`, `NOT_IN_ROOM`, `NOT_HOST`, `NOT_FOUND`, `INTERNAL_ERROR`.

Broadcasts: `ban:cleared`.

### `member:banned`

Direction: server → room broadcast and direct target socket event.

Payload:

```ts
{
  roomId: string
  bannedUserId: string
  bannedByUserId: string
  createdAt: string
}
```

### `ban:cleared`

Direction: server → room broadcast.

Payload:

```ts
{
  roomId: string
  clearedUserId: string
  clearedByUserId: string
  clearedAt: string
}
```

## Report events

### `report:create`

Direction: client → server command.

Payload:

```ts
{
  roomId?: string
  targetType: 'account' | 'room' | 'stream_session' | 'chat_message'
  targetId: string
  reason: string
  details?: string
}
```

Ack data:

```ts
{
  report: ReportSummary
}
```

Server behavior: validates target. If target is active stream and latest thumbnail exists, freezes thumbnail snapshot into PostgreSQL.

Errors: `UNAUTHENTICATED`, `FULLY_SUSPENDED`, `NOT_FOUND`, `VALIDATION_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`.

Broadcasts: `admin:reportCreated` to connected admins.

## Admin events

All admin commands require Platform Admin authorization from the static Discord ID allowlist.

### `admin:join`

Direction: client → server command.

Payload: `{}`

Ack data:

```ts
{
  liveRooms: RoomSummary[]
  openReports: ReportSummary[]
}
```

Server side effect: joins admin socket to `discovery` and admin-only internal room if implemented.

Errors: `UNAUTHENTICATED`, `NOT_PLATFORM_ADMIN`, `INTERNAL_ERROR`.

### `admin:endRoom`

Direction: client → server command.

Payload:

```ts
{
  roomId: string
  reason?: string
}
```

Ack data:

```ts
{
  room: RoomSummary
}
```

Errors: `UNAUTHENTICATED`, `NOT_PLATFORM_ADMIN`, `NOT_FOUND`, `ROOM_NOT_LIVE`, `INTERNAL_ERROR`.

Broadcasts: `room:ended`, `discovery:roomEnded`, `stream:stopped` for active streams.

### `admin:createSanction`

Direction: client → server command.

Payload:

```ts
{
  userId: string
  type: PlatformSanctionType
  reason: string
  startsAt?: string
  expiresAt?: string
}
```

Ack data:

```ts
{
  sanction: PlatformSanction
}
```

Errors: `UNAUTHENTICATED`, `NOT_PLATFORM_ADMIN`, `NOT_FOUND`, `VALIDATION_FAILED`, `INTERNAL_ERROR`.

Broadcasts: `admin:sanctionCreated`; direct `sanction:created` to affected connected user if online.

### `admin:liftSanction`

Direction: client → server command.

Payload:

```ts
{
  sanctionId: string
}
```

Ack data:

```ts
{
  sanction: PlatformSanction
}
```

Errors: `UNAUTHENTICATED`, `NOT_PLATFORM_ADMIN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`.

Broadcasts: `admin:sanctionLifted`; direct `sanction:lifted` to affected connected user if online.

### `admin:resolveReport`

Direction: client → server command.

Payload:

```ts
{
  reportId: string
  resolution: 'resolved' | 'dismissed'
  note?: string
}
```

Ack data:

```ts
{
  report: ReportSummary
}
```

Errors: `UNAUTHENTICATED`, `NOT_PLATFORM_ADMIN`, `NOT_FOUND`, `VALIDATION_FAILED`, `CONFLICT`, `INTERNAL_ERROR`.

Broadcasts: `admin:reportResolved`.

### `admin:reportCreated`

Direction: server → admin broadcast.

Payload:

```ts
{
  report: ReportSummary
}
```

### `admin:reportResolved`

Direction: server → admin broadcast.

Payload:

```ts
{
  report: ReportSummary
}
```

### `admin:sanctionCreated`

Direction: server → admin broadcast.

Payload:

```ts
{
  sanction: PlatformSanction
}
```

### `admin:sanctionLifted`

Direction: server → admin broadcast.

Payload:

```ts
{
  sanction: PlatformSanction
}
```

### `sanction:created`

Direction: server → affected user direct event.

Payload:

```ts
{
  sanction: PlatformSanction
}
```

### `sanction:lifted`

Direction: server → affected user direct event.

Payload:

```ts
{
  sanction: PlatformSanction
}
```

## Error-code mapping guidelines

- `UNAUTHENTICATED`: no valid Better Auth session.
- `FORBIDDEN`: authenticated but the action is not allowed and no narrower code applies.
- `NOT_FOUND`: referenced entity does not exist or is intentionally hidden.
- `VALIDATION_FAILED`: Zod payload validation failed.
- `RATE_LIMITED`: Valkey rate limit rejected the action.
- `ROOM_NOT_LIVE`: room is ended or cannot accept the command in its current state.
- `ROOM_FULL`: room capacity is exhausted and no reconnect slot exists.
- `PASSWORD_REQUIRED`: private room join omitted password.
- `INVALID_PASSWORD`: private room password mismatch.
- `ROOM_BANNED`: account has an effective room ban.
- `FULLY_SUSPENDED`: account has effective full suspension.
- `CHAT_BANNED`, `STREAM_BANNED`, `ROOM_CREATION_BANNED`: effective platform sanction blocks specific action.
- `NOT_HOST`: command requires current room host.
- `NOT_PLATFORM_ADMIN`: command requires platform admin.
- `STREAM_NOT_ACTIVE`: stream session is missing, ended, or not active.
- `STREAM_ALREADY_ACTIVE`: socket user already has an active stream in the room.
- `TARGET_NOT_IN_ROOM`: target user/socket is not currently admitted to the room.
- `TARGET_SOCKET_NOT_FOUND`: target socket cannot be resolved.
- `THUMBNAIL_TOO_LARGE`: thumbnail exceeds 100 KB cap.
- `UNSUPPORTED_BROWSER`: browser cannot start streams under v1 support policy.
- `CONNECTION_FAILED`: client-side watch setup exhausted retry budget.
- `CONFLICT`: command is valid but stale, already resolved, already lifted, or otherwise conflicts with current state.
- `INTERNAL_ERROR`: unexpected server failure after validation.
