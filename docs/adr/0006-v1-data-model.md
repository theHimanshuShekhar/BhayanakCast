# V1 data model

BhayanakCast uses Better Auth user IDs as product foreign keys while v1 public identity mirrors Discord. The core room lifecycle is a single `rooms` aggregate with states `live`, `empty_grace`, and `ended`; an ended room is a Past Stream rather than a copied archive record.

## Consequences

- `rooms.currentHostUserId` is the source of truth for host ownership.
- Room membership is append-only history with join/leave intervals; live presence is coordinated through Socket.IO.
- `stream_sessions` records each member stream start/stop; a member may have multiple stream sessions in one room.
- Stream subscriptions are live-only Socket.IO/WebRTC state and are not persisted.
- Chat messages are validated, persisted, then broadcast; transcripts are retained for hosts and platform admins, not reconnect backfill.
- Latest blurred stream preview thumbnails are in-memory only; report thumbnail snapshots are persisted in PostgreSQL `bytea`.
- Nightly aggregation writes per-user daily facts and unordered user-pair daily facts; profile/admin stats show `lastUpdatedAt`.
- Reports can target an account, room, stream session, or chat message.
- Platform sanctions are append-only records with type, reason, creator, start, optional expiry, and optional lift timestamp.
- Room bans are separate rows effective until cleared by the host or until the room ends.
- V1 does not automatically expire product history. Past streams, transcripts, reports, report thumbnail snapshots, sanctions, bans, memberships, stream sessions, and aggregate facts remain until explicit manual/admin deletion exists.
