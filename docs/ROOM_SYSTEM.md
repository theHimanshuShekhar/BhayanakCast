# Room System

## Architecture

```
Client → WebSocket Server → Database (sync, await) → Broadcast to Room
              ↓
         In-Memory State (primary runtime source of truth)
```

- Frontend **never** writes to DB directly — all room ops via WebSocket
- DB writes block before any broadcast (consistency guarantee)
- On server restart: clients auto-rejoin → state rebuilt from DB

## Room Status

| Status | Description | Transition |
|--------|-------------|------------|
| **waiting** | No streamer assigned | First user joins → preparing |
| **preparing** | Streamer present, < 2 participants | 2nd joins → active |
| **active** | 2+ participants, streamer assigned | Streamer leaves → preparing |
| **ended** | Empty 5+ minutes | Cleanup job → ended |

Room only ends via the 5-minute cleanup job — not when the stream stops.

## Key Business Rules

### Streamer Transfer
When the streamer leaves, a DB transaction atomically:
1. Marks streamer as left (calculates watch time)
2. Finds earliest-joined active viewer as new streamer
3. If no viewers: clears `streamerId`, sets status → `waiting`
4. Broadcasts `room:streamer_changed` after DB success

30-second transfer cooldown, keyed as `${roomId}:${userId}`.

### One Room Per User
Users can only be in one room at a time. Joining a new room auto-leaves the old one. Enforced in WebSocket join handler before DB write.

### Mobile Users
Mobile users can join and view but **cannot** be assigned as streamer.

### Room Activation
`waiting → preparing`: first user joins (they become streamer)
`preparing → active`: second user joins (2+ participants in room)

## In-Memory State

```typescript
// websocket/room/state.ts
interface RoomState {
  id: string;
  name: string;
  description?: string;
  streamerId: string | null;
  streamerPeerId: string | null;  // PeerJS peer ID for WebRTC connections
  status: "waiting" | "preparing" | "active" | "ended";
  participants: Map<string, ParticipantState>;
  createdAt: Date;
  dbConfirmed: boolean;
}

interface ParticipantState {
  userId: string;
  userName: string;
  userImage?: string;
  socketId: string;
  joinedAt: Date;
  isMobile: boolean;
}
```

## Lifecycle Flows

### Create
1. Client emits `room:create`
2. Server validates → inserts to DB (awaits)
3. On success: creates in-memory state → emits `room:created`
4. On failure: emits `room:create_error`, no state created

### Join
1. Client emits `room:join`
2. Server checks in-memory (room must exist, not ended)
3. If user in another room, auto-leave first
4. Insert participant to DB (awaits)
5. On success: update in-memory state, update room status → broadcast

### Leave / Disconnect
1. Update DB: set `leftAt`, calculate `totalTimeSeconds`
2. Remove from in-memory state
3. Handle streamer transfer if needed
4. Broadcast `room:user_left`
5. If empty → status = `waiting` (NOT ended)

### Rejoin (Auto-Recovery)
On reconnect, client emits `room:rejoin`:
- **Room exists in memory:** add participant back, emit `room:state_sync`
- **Room lost (server restart):** query DB, rebuild state, emit `room:state_sync`
- Broadcasts `room:user_joined` to others either way

### Cleanup Job (every 5 min)
Ends rooms where: status = `waiting` AND empty AND created > 5 min ago.

## Socket Events

### Client → Server
| Event | Payload |
|-------|---------|
| `room:create` | `{ name, description? }` |
| `room:join` | `{ roomId }` |
| `room:leave` | `{ roomId }` |
| `room:rejoin` | `{ roomId, userId }` |
| `streamer:transfer` | `{ roomId, newStreamerId }` |
| `chat:send` | `{ roomId, content }` |

### Server → Client
| Event | Description |
|-------|-------------|
| `room:created` | Room created, full state |
| `room:joined` | Joined successfully, full room state |
| `room:state_sync` | Full state (rejoin/reconnect) |
| `room:user_joined` | Someone joined, updated state |
| `room:user_left` | Someone left, updated state |
| `room:streamer_changed` | Streamer changed (includes `newStreamerId`) |
| `room:status_changed` | Room status updated |
| `room:ended` | Room ended by cleanup job |
| `room:create_error` / `room:join_error` / `room:error` | Error messages |

## Rate Limits

| Operation | Limit | Window |
|-----------|-------|--------|
| Create room | 3 | 60s |
| Join room | 10 | 60s |
| Leave room | 5 | 60s |
| Streamer transfer | 1 per `${roomId}:${userId}` | 30s |

## See Also
- [Database Schema](./DATABASE_SCHEMA.md)
- [WebSocket Events](./WEBSOCKET_EVENTS.md)
- [Rate Limiting](./RATE_LIMITING.md)
