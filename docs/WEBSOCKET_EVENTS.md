# WebSocket Events Reference

All room operations go through WebSocket with synchronous DB persistence. See [WebSocket Architecture](./WEBSOCKET_ARCHITECTURE.md) for the full architecture.

## Connection

```
Client connects → identifies → room:rejoin (if was in room)
                             → room:create / room:join (new session)
```

Rate limit: 30 connections/min per IP.

---

## Client → Server

### `identify`
Send user info after connecting.
```typescript
socket.emit("identify", { userId, userName, userImage, isMobile });
```

### `room:create`
```typescript
socket.emit("room:create", { name: string, description?: string });
// Rate limit: 3/60s
```

### `room:join`
```typescript
socket.emit("room:join", { roomId: string });
// Rate limit: 10/60s. Auto-leaves current room first if in one.
```

### `room:leave`
```typescript
socket.emit("room:leave", { roomId: string });
// Rate limit: 5/60s
```

### `room:rejoin`
Automatically called by client on reconnect if was in a room.
```typescript
socket.emit("room:rejoin", { roomId: string, userId: string });
```

### `streamer:transfer`
```typescript
socket.emit("streamer:transfer", { roomId: string, newStreamerId: string });
// Rate limit: 1/30s per roomId:userId. Must be current streamer.
```

### `chat:send`
```typescript
socket.emit("chat:send", { roomId: string, content: string });
// Rate limits: 30/15s sustained + 5/3s rapid burst
// Content is profanity-filtered server-side before broadcast
```

### PeerJS Streaming Events

#### `peerjs:ready`
Viewer registers their PeerJS peer ID.
```typescript
socket.emit("peerjs:ready", { peerId: string });
// Rate limit: WEBRTC_SIGNALING (200/min)
```

#### `peerjs:streamer_ready`
Streamer announces they are ready to receive connections.
```typescript
socket.emit("peerjs:streamer_ready", { roomId, peerId, audioConfig });
// Server stores peerId in RoomState.streamerPeerId + broadcasts room:state_sync
// Rate limit: WEBRTC_SIGNALING (200/min)
```

#### `peerjs:screen_share_ended`
Streamer notifies server that screen sharing stopped.
```typescript
socket.emit("peerjs:screen_share_ended", { roomId: string });
// Rate limit: WEBRTC_SIGNALING (200/min)
```

---

## Server → Client

### Room Events

| Event | When | Key Payload |
|-------|------|-------------|
| `room:created` | Room created | `{ room, participant }` |
| `room:joined` | Joined successfully | `{ roomId, participant, roomState }` |
| `room:state_sync` | Full sync (rejoin/reconnect) | `{ roomId, roomState }` |
| `room:user_joined` | Someone joined | `{ userId, userName, participantCount, roomState }` |
| `room:user_left` | Someone left | `{ userId, userName, participantCount, newStreamerId?, roomState }` |
| `room:streamer_changed` | Streamer changed | `{ newStreamerId, newStreamerName }` |
| `room:status_changed` | Status updated | `{ status }` |
| `room:ended` | Room ended (cleanup job) | `{ roomId }` |
| `room:create_error` | Create failed | `{ message }` |
| `room:join_error` | Join failed | `{ message }` |
| `room:error` | General error | `{ message }` |

### Chat Events

| Event | When | Key Payload |
|-------|------|-------------|
| `chat:message` | New message | `{ id, userId, userName, userImage?, content, timestamp, type }` |
| `chat:error` | Rate limited or error | `{ message, retryAfter? }` |

### PeerJS Streaming Events

| Event | When | Key Payload |
|-------|------|-------------|
| `peerjs:streamer_ready` | Broadcast to viewers: streamer PeerJS ID available | `{ peerId, roomId, audioConfig }` |
| `peerjs:streamer_changed` | Streamer changed — reconnect needed | `{ newStreamerPeerId: string \| null, newStreamerName }` |

**Note:** `newStreamerPeerId` may be `null` if the new streamer hasn't called `peerjs:streamer_ready` yet. In that case, wait for the subsequent `room:state_sync` which will carry the new `streamerPeerId` once registered.

---

## TypeScript Types

```typescript
interface RoomState {
  id: string;
  name: string;
  description?: string;
  status: "waiting" | "preparing" | "active" | "ended";
  streamerId: string | null;
  streamerPeerId: string | null;
  participants: Participant[];
  createdAt: Date;
}

interface Participant {
  userId: string;
  userName: string;
  userImage?: string;
  joinedAt: Date;
  isMobile: boolean;
}

interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  userImage?: string;
  content: string;        // Already profanity-filtered
  timestamp: number;
  type: "user" | "system";
}

// ServerToClientEvents (partial)
interface ServerToClientEvents {
  "room:created": (data: { room: Room; participant: Participant }) => void;
  "room:joined": (data: { roomId: string; participant: Participant; roomState: RoomState }) => void;
  "room:state_sync": (data: { roomId: string; roomState: RoomState }) => void;
  "room:user_joined": (data: { userId: string; userName: string; participantCount: number; roomState: RoomState }) => void;
  "room:user_left": (data: { userId: string; userName: string; participantCount: number; newStreamerId?: string; newStreamerName?: string; roomState: RoomState }) => void;
  "room:streamer_changed": (data: { newStreamerId: string; newStreamerName: string }) => void;
  "room:ended": (data: { roomId: string }) => void;
  "chat:message": (message: ChatMessage) => void;
  "peerjs:streamer_ready": (data: { peerId: string; roomId: string; audioConfig: unknown }) => void;
  "peerjs:streamer_changed": (data: { newStreamerPeerId: string | null; newStreamerName: string }) => void;
}

// ClientToServerEvents
interface ClientToServerEvents {
  identify: (data: { userId?: string; userName?: string; userImage?: string | null; isMobile: boolean }) => void;
  "room:create": (data: { name: string; description?: string }) => void;
  "room:join": (data: { roomId: string }) => void;
  "room:leave": (data: { roomId: string }) => void;
  "room:rejoin": (data: { roomId: string; userId: string }) => void;
  "streamer:transfer": (data: { roomId: string; newStreamerId: string }) => void;
  "chat:send": (data: { roomId: string; content: string }) => void;
  "peerjs:ready": (data: { peerId: string }) => void;
  "peerjs:streamer_ready": (data: { roomId: string; peerId: string; audioConfig: unknown }) => void;
  "peerjs:screen_share_ended": (data: { roomId: string }) => void;
}
```

## Common Errors

```
"Not authenticated"                          — identify not called
"You must join the room first"               — not in room
"Room not found" / "Room has already ended"  — invalid roomId
"Only the streamer can transfer ownership"   — permission denied
"Transfer cooldown active. Try again in Xs." — rate limited
"You're sending messages too quickly."       — chat rate limit
```

## See Also
- [Room System](./ROOM_SYSTEM.md)
- [Rate Limiting](./RATE_LIMITING.md)
- [WebSocket Architecture](./WEBSOCKET_ARCHITECTURE.md)
