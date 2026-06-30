# Realtime protocol

BhayanakCast uses Socket.IO for realtime coordination and room-scoped WebRTC signaling. Socket.IO events have event-specific Zod payloads; client-initiated commands return a standard result ack: `{ ok: true, data?: T } | { ok: false, code: string, message: string }`.

The exact event catalog, payload shapes, acknowledgements, broadcasts, and stable error codes are maintained in [`../socket-events.md`](../socket-events.md).

## Consequences

- Join validation checks Better Auth session, full-account suspension, room state, room ban, private-room password, capacity, and reconnect slot before `socket.join(roomId)`.
- Home and admin live lists use a separate Socket.IO `discovery` room for room created/updated/ended/revived events.
- Joining a room in `empty_grace` sets it back to `live`, assigns the joiner as host, and emits `room:revived`, `host:changed`, and `member:joined`.
- One account may have only one active socket per room. A new socket replaces the old socket; old streams stop and old stream subscriptions drop.
- A client captures display media before sending `stream:start`; the server creates a `stream_sessions` row and broadcasts stream availability.
- Stream metadata includes actual captured track flags such as `hasAudio`, because browser stream-audio support is best-effort.
- Viewers initiate WebRTC connections when they choose to watch a stream. Signaling payloads are room-scoped and target a specific socket; the server verifies both sockets are room members and the stream is active before relaying.
- Watch connection setup uses bounded automatic retry: 3 attempts over 15 seconds. After that, the tile shows a user-visible connection error and a manual Retry button.
- Stream thumbnails are sent as Socket.IO binary `stream:thumbnail` events every two minutes, capped at 100 KB, and stored only as latest in-memory previews unless frozen into a report.
- Stream end is explicit server state: `stream:stopped` causes viewers to close peer connections. Unexpected streamer disconnects stop active streams immediately even if the member slot remains in reconnect grace.
- Chat send flow is validate, persist, then broadcast the canonical persisted message row.
- Host controls are explicit commands: stop stream, ban member, clear ban. Server authorizes the caller as the current host.
- Live reports are Socket.IO commands and may freeze the latest stream thumbnail snapshot for platform-admin review.
