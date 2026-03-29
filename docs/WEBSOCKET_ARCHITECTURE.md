# WebSocket-First Architecture

## Overview

All room operations go through the WebSocket server. The frontend never writes to the database directly.

```
Frontend → WebSocket Server → Database (sync, await) → Broadcast to Room
              ↓
         In-Memory Maps (primary runtime source of truth)
```

**Key principles:**
1. In-memory state is authoritative during runtime
2. DB writes complete before any broadcast (no eventual consistency)
3. DB is the recovery layer on server restart
4. Frontend subscribes to events — no polling

## In-Memory State

```typescript
// websocket/room/state.ts
const roomStates = new Map<string, RoomState>();

interface RoomState {
  id: string;
  name: string;
  streamerId: string | null;
  streamerPeerId: string | null;
  status: "waiting" | "preparing" | "active" | "ended";
  participants: Map<string, ParticipantState>;
  createdAt: Date;
  dbConfirmed: boolean;
}
```

## DB Transaction Pattern

All critical operations (join, leave, transfer) use Postgres transactions:
```
1. Client emits event
2. Server validates
3. DB transaction executes (awaits)
4. On success → update in-memory state + broadcast
5. On failure → emit error to client, state unchanged
```

No partial state updates — in-memory and DB stay consistent.

## Server Restart Recovery

When the WS server restarts, all in-memory state is lost. Clients automatically recover:

```
Server restarts → all clients disconnect
→ Clients reconnect and emit room:rejoin
→ Server queries DB, rebuilds RoomState in memory
→ Emits room:state_sync to each rejoining client
→ Room continues normally
```

Client-side auto-rejoin is in `src/lib/websocket-context.tsx`:
```typescript
socket.on("connect", () => {
  if (currentRoomId && userId) {
    socket.emit("room:rejoin", { roomId: currentRoomId, userId });
  }
});
```

## Cleanup Strategy

A `setInterval` runs every 5 minutes. Rooms that have been in `waiting` status with zero participants for 5+ minutes are ended:
- DB updated: `status = "ended"`, `endedAt = now`
- Removed from in-memory state
- `room:ended` broadcast to any connected clients

## PeerJS Streaming Layer

Streaming is layered on top of the WebSocket room system using PeerJS (WebRTC abstraction):

```
1. Streamer gets Peer instance from PeerJSContext (singleton)
2. On peer.on("open") → emits peerjs:streamer_ready { roomId, peerId }
3. Server stores peerId in RoomState.streamerPeerId → broadcasts room:state_sync
4. Viewers receive streamerPeerId → call connectToStreamer(peerId)
5. PeerJS handles WebRTC offer/answer/ICE → P2P stream established
```

Viewers auto-connect on late join via `streamerPeerId` from room state (no new event needed).

## File Structure

```
websocket/
├── websocket-server.ts     # Entry point, SocketUserData, socket lifecycle
├── room/
│   ├── state.ts            # In-memory Maps, RoomState type, serialization
│   ├── events.ts           # room:create/join/leave/rejoin/transfer handlers
│   └── persistence.ts      # DB write operations
├── streaming/
│   ├── events.ts           # peerjs:ready/streamer_ready/screen_share_ended
│   └── types.ts            # Event payload types
└── chat/
    ├── events.ts           # chat:send handler
    └── types.ts
```

**`SocketUserData`** (exported from `websocket-server.ts`) is the canonical socket data type. Import it — never redefine locally.

## Multi-Server (Future)

Current implementation is single-server. When scaling, swap `InMemoryBackend` in `src/lib/rate-limiter.ts` to `ValkeyBackend` — all rate limits become distributed automatically with no other code changes.

## See Also
- [Room System](./ROOM_SYSTEM.md)
- [WebSocket Events](./WEBSOCKET_EVENTS.md)
- [Project Structure](./PROJECT_STRUCTURE.md)
