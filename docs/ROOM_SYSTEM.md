# Room System

Complete guide to rooms, their lifecycle, and business logic.

## Architecture Overview

**WebSocket-First Architecture:**
```
Client → WebSocket Server → Database (wait for confirmation) → Broadcast to Room
         ↓
    In-Memory State (primary runtime source of truth)
```

**Key Principles:**
- **WebSocket server** maintains primary room state in memory during runtime
- **Database** is the persistence layer - all writes wait for DB confirmation
- **Frontend** never writes to database directly - all operations via WebSocket
- **On server restart**: State is rebuilt from client rejoins (clients automatically rejoin and sync state)

## Room Status States

Rooms progress through 4 states:

| Status | Description | Visual | Transition |
|--------|-------------|--------|------------|
| **waiting** | Room created, no streamer | Gray dot | Creator joins → preparing |
| **preparing** | Streamer present, < 2 viewers | Yellow dot | 2nd join → active |
| **active** | Live streaming (2+ people) | Green dot + LIVE | Last leave → waiting |
| **ended** | Room closed | History icon | Empty 5min + old → ended |

## Room Lifecycle

### 1. Creation Flow

```
User clicks "Create Room"
    ↓
Frontend emits 'room:create' via WebSocket
    ↓
WebSocket validates input
    ↓
WebSocket inserts to database (SYNCHRONOUS - waits for confirmation)
    ↓
On DB success:
  - Create RoomState in memory
  - Emit 'room:created' to creator
  - Room visible to others after DB confirmation
    ↓
On DB failure:
  - Emit 'room:create_error' to creator
  - No state created, no broadcast
```

**Important:** Room is only joinable after database confirmation. WebSocket maintains `dbConfirmed: boolean` flag.

### 2. Joining Flow

```
User clicks "Join Room"
    ↓
Frontend emits 'room:join' { roomId }
    ↓
WebSocket checks in-memory state (room must exist and not be ended)
    ↓
WebSocket inserts participant to database (SYNCHRONOUS)
    ↓
On DB success:
  - Add participant to in-memory RoomState
  - Update room status if needed (waiting → preparing → active)
  - Emit 'room:joined' to joining user (full room state)
  - Broadcast 'room:user_joined' to others
    ↓
On DB failure:
  - Emit 'room:join_error' to user
  - State unchanged
```

### 3. Leaving Flow

```
User clicks "Leave Room" OR disconnects
    ↓
WebSocket updates database (set leftAt, calculate watch time)
    ↓
On DB success:
  - Remove participant from in-memory RoomState
  - Handle streamer transfer if needed (in DB transaction)
  - Update room status
  - Broadcast 'room:user_left'
  - If room empty → status = waiting (NOT ended)
    ↓
Note: Room only ends via cleanup job after 5+ minutes empty
```

### 4. Rejoin/Rebuild Flow (Server Restart Recovery)

**When WebSocket server restarts, all room state is lost. Clients automatically recover:**

```
Client connects/reconnects
    ↓
Client was in a room before disconnect
    ↓
Client emits 'room:rejoin' { roomId, userId }
    ↓
WebSocket checks if room exists in memory:

  CASE A: Room exists in memory
    - Add participant back
    - Emit 'room:state_sync' with full room state
    - Broadcast 'room:user_joined' to others
    
  CASE B: Room doesn't exist (server restarted)
    - Query database for room
    - Query database for current participants
    - Rebuild RoomState in memory
    - Add rejoining participant
    - Emit 'room:state_sync' to rejoining user
    - Broadcast 'room:user_joined' to others
    
All other clients receive 'room:user_joined' and update their state
```

**Key Point:** Rejoin logic automatically triggers on reconnection. No manual user action needed.

### 5. Cleanup Flow

```
Room in "waiting" status
    ↓
Empty for 5+ minutes AND room created > 5 minutes ago
    ↓
Cleanup job runs (every 5 minutes)
    ↓
Update database: status = "ended", endedAt = now
    ↓
Remove from in-memory state
    ↓
Broadcast 'room:ended'
    ↓
Room visible in "Past Streams" for 3 hours
```

## Business Rules

### Streamer Transfer

When the streamer leaves, database handles transfer atomically:

```typescript
// Database transaction ensures consistency
await db.transaction(async (trx) => {
  // 1. Mark streamer as left
  await trx.update(roomParticipants)
    .set({ leftAt: new Date(), totalTimeSeconds: calculated })
    .where(eq(roomParticipants.id, streamerParticipantId));
  
  // 2. Find next viewer (earliest joined)
  const nextViewer = await trx.select()
    .from(roomParticipants)
    .where(and(
      eq(roomParticipants.roomId, roomId),
      isNull(roomParticipants.leftAt)
    ))
    .orderBy(asc(roomParticipants.joinedAt))
    .limit(1);
  
  // 3. Transfer streamer ownership
  if (nextViewer.length > 0) {
    await trx.update(streamingRooms)
      .set({ streamerId: nextViewer[0].userId })
      .where(eq(streamingRooms.id, roomId));
  } else {
    // No viewers, clear streamer
    await trx.update(streamingRooms)
      .set({ streamerId: null, status: "waiting" })
      .where(eq(streamingRooms.id, roomId));
  }
});

// After DB success, WebSocket broadcasts:
// - 'room:streamer_changed' to all participants
// - 'room:user_left' for the departing user
```

**Cooldown:** 30 seconds between transfers (checked in database rate limiter)

### Single Room Rule

Users can only be in **ONE** room at a time:

```typescript
// WebSocket server enforces this:
// 1. On 'room:join', check if user is already in another room
// 2. If yes, emit 'room:leave' for current room first
// 3. Then process the new join
// 4. All database operations in transaction
```

### Room Activation

A room becomes "active" when:
- Status is "preparing" AND
- 2nd participant joins (database transaction)

```typescript
// Inside join transaction:
const participantCount = await trx.select({ count: sql<number>`count(*)` })
  .from(roomParticipants)
  .where(and(
    eq(roomParticipants.roomId, roomId),
    isNull(roomParticipants.leftAt)
  ));

if (participantCount[0].count >= 2 && room.status === "preparing") {
  await trx.update(streamingRooms)
    .set({ status: "active" })
    .where(eq(streamingRooms.id, roomId));
}
```

## State Management

### In-Memory State (WebSocket Server)

Located in `websocket/room-state.ts`:

```typescript
interface RoomState {
  id: string;
  name: string;
  description?: string;
  streamerId: string | null;
  status: 'waiting' | 'preparing' | 'active' | 'ended';
  participants: Map<string, ParticipantState>;
  createdAt: Date;
  dbConfirmed: boolean; // true after DB write succeeds
}

interface ParticipantState {
  userId: string;
  userName: string;
  userImage?: string;
  socketId: string;
  joinedAt: Date;
  isMobile: boolean;
}

// Global state store
const roomStates = new Map<string, RoomState>();
```

### Database State

Tables act as persistence layer:
- `streamingRooms` - Room metadata (source of truth on restart)
- `roomParticipants` - Participation history with `leftAt` timestamp
- All writes synchronous (wait for confirmation)

### Frontend State

- Subscribes to WebSocket events for real-time updates
- Uses 'room:state_sync' for initial state and rejoins
- No direct database queries for room operations
- React Query used for room list (with WebSocket invalidation)

## Socket.io Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `room:create` | `{ name: string, description?: string }` | Create new room |
| `room:join` | `{ roomId: string }` | Join existing room |
| `room:leave` | `{ roomId: string }` | Leave room |
| `room:rejoin` | `{ roomId: string, userId: string }` | Reconnect and rebuild state |
| `chat:send` | `{ roomId: string, content: string }` | Send chat message |
| `streamer:transfer` | `{ roomId: string, newStreamerId: string }` | Transfer ownership |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `room:created` | `{ room: Room, participant: Participant }` | Room created successfully |
| `room:create_error` | `{ message: string }` | Room creation failed |
| `room:joined` | `{ roomId: string, participant: Participant, roomState: RoomState }` | Successfully joined |
| `room:join_error` | `{ message: string }` | Join failed |
| `room:state_sync` | `{ roomId: string, roomState: RoomState }` | Full room state (for rejoins) |
| `room:user_joined` | `{ userId, userName, participantCount, roomState: RoomState }` | Someone joined |
| `room:user_left` | `{ userId, userName, participantCount, newStreamerId? }` | Someone left |
| `room:streamer_changed` | `{ newStreamerId, newStreamerName }` | Streamer changed |
| `room:status_changed` | `{ status: string }` | Room status updated |
| `room:ended` | `{ roomId: string }` | Room has ended |
| `chat:message` | `{ id, userId, userName, content, timestamp }` | New message |
| `chat:error` | `{ message: string }` | Chat error |

## Error Handling

### Database Write Failures

All database operations are synchronous. On failure:

1. **Transaction rolls back** - No partial state changes
2. **In-memory state unchanged** - Stays consistent with DB
3. **Error emitted to client** - Client shows error, can retry
4. **No broadcast** - Other clients unaffected

### Reconnection Handling

```typescript
// Client-side reconnection logic:
socket.on('connect', () => {
  if (currentRoomId && currentUserId) {
    // Auto-rejoin after reconnect
    socket.emit('room:rejoin', { 
      roomId: currentRoomId, 
      userId: currentUserId 
    });
  }
});

// Server handles rejoin:
socket.on('room:rejoin', async (data) => {
  // Rebuild state if needed, sync to client
});
```

## Rate Limits

Room operations have rate limits (enforced before DB write):

| Operation | Limit | Window |
|-----------|-------|--------|
| Create room | 3 | 60 seconds |
| Join room | 10 | 60 seconds |
| Leave room | 5 | 60 seconds |
| Transfer streamer | 1 | 30 seconds |

See [Rate Limiting](./RATE_LIMITING.md) for implementation details.

## Cleanup Job

Runs every 5 minutes via `setInterval`:

```typescript
// Check in-memory state first
for (const [roomId, roomState] of roomStates) {
  if (roomState.status === 'waiting' && 
      roomState.participants.size === 0 &&
      roomState.createdAt < fiveMinutesAgo) {
    
    // Update database
    await db.update(streamingRooms)
      .set({ status: 'ended', endedAt: new Date() })
      .where(eq(streamingRooms.id, roomId));
    
    // Remove from memory
    roomStates.delete(roomId);
    
    // Notify any connected clients
    broadcastToRoom(roomId, 'room:ended', { roomId });
  }
}
```

## File Structure

```
websocket/
├── websocket-server.ts      # Main server, event routing
├── websocket-room-manager.ts # Room management logic
├── room-state.ts            # In-memory state management ⭐ NEW
├── room-events.ts           # Room event handlers ⭐ NEW
├── db-persistence.ts        # Database write operations ⭐ NEW
└── chat-handler.ts          # Chat events

src/
├── routes/
│   ├── room.$roomId.tsx     # Room page (WebSocket only)
│   └── index.tsx            # Room list
├── components/
│   ├── CreateRoomModal.tsx  # Emits 'room:create'
│   └── StreamerControls.tsx # Room controls
├── lib/
│   └── websocket-context.tsx # WebSocket connection + room helpers
└── hooks/
    └── useRoom.ts           # Room state subscription ⭐ NEW
```

## See Also

- [Database Schema](./DATABASE_SCHEMA.md) - Table definitions
- [WebSocket Events](./WEBSOCKET_EVENTS.md) - Complete event reference
- [Rate Limiting](./RATE_LIMITING.md) - Rate limit configurations
- [WebSocket Architecture](./WEBSOCKET_ARCHITECTURE.md) - Server restart recovery

## Migration Notes

**From HTTP-First to WebSocket-First:**

| Old (HTTP) | New (WebSocket) |
|------------|-----------------|
| `createRoom()` server fn | `socket.emit('room:create')` |
| `joinRoom()` server fn | `socket.emit('room:join')` |
| `leaveRoom()` server fn | `socket.emit('room:leave')` |
| HTTP polling for state | WebSocket events + state_sync |
| Database as primary | In-memory as primary, DB as persistence |
| Manual reconnection | Auto-rejoin with state rebuild |
