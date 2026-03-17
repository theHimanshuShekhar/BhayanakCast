# WebSocket-First Architecture

This document explains the WebSocket-first architecture where the WebSocket server maintains primary room state in memory, with the database acting as a persistence layer.

## Overview

**Traditional Architecture (HTTP-First):**
```
Frontend → HTTP API → Database → Response → WebSocket Broadcast
```

**WebSocket-First Architecture:**
```
Frontend → WebSocket Server → Database (sync) → Broadcast to Room
              ↓
         In-Memory State (primary runtime source)
```

## Key Principles

### 1. Single Source of Truth During Runtime

The WebSocket server's in-memory state is the authoritative source for:
- Current room participants
- Room status (waiting/preparing/active/ended)
- Streamer assignment
- Real-time presence

### 2. Synchronous Database Persistence

All state changes are persisted to the database **synchronously** before broadcasting:
1. Client emits event
2. WebSocket validates
3. Database transaction executes (waits for confirmation)
4. On success: Update in-memory state + broadcast
5. On failure: Return error, no state change

### 3. Database as Recovery Layer

The database serves as:
- **Persistence**: All operations are recorded
- **Recovery**: On server restart, state is rebuilt from database
- **Audit**: Historical data for analytics

### 4. No Frontend Database Writes

Frontend NEVER writes to database directly:
- ❌ `createServerFn` for room operations
- ❌ Direct DB queries from components
- ✅ All operations via WebSocket events

## State Management

### In-Memory State (WebSocket Server)

```typescript
// websocket/room-state.ts

interface RoomState {
  id: string;
  name: string;
  description?: string;
  streamerId: string | null;
  status: 'waiting' | 'preparing' | 'active' | 'ended';
  participants: Map<string, ParticipantState>;
  createdAt: Date;
  dbConfirmed: boolean; // Track DB persistence
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

### Database State (PostgreSQL)

```typescript
// Tables act as persistence layer

streamingRooms: {
  id, name, description, streamerId, status,
  createdAt, updatedAt, endedAt
}

roomParticipants: {
  id, roomId, userId, joinedAt, leftAt, totalTimeSeconds
}
```

### Frontend State (React)

```typescript
// Subscribe to WebSocket events
// No direct DB queries for room operations

const { roomState } = useRoom(roomId);
// roomState comes from 'room:state_sync' and update events
```

## Server Restart Recovery

### Problem

When the WebSocket server restarts:
- All in-memory state is lost (`roomStates` Map is empty)
- Connected clients are disconnected
- Rooms appear to "disappear"

### Solution: Automatic Rejoin Protocol

```
1. Server restarts
2. All clients disconnected
3. Clients automatically reconnect
4. Each client emits 'room:rejoin' with their userId
5. Server rebuilds state from database
6. All clients receive 'room:state_sync' with full state
7. Room continues normally
```

### Implementation

**Client-Side (Automatic):**
```typescript
// src/lib/websocket-context.tsx

socket.on("connect", () => {
  if (currentRoomId && userId) {
    // Auto-rejoin after reconnect
    socket.emit("room:rejoin", { 
      roomId: currentRoomId, 
      userId 
    });
  }
});
```

**Server-Side (State Rebuild):**
```typescript
// websocket/room-events.ts

socket.on("room:rejoin", async (data) => {
  const { roomId, userId } = data;
  
  // Check if room exists in memory
  if (!roomStates.has(roomId)) {
    // Room lost in restart - rebuild from DB
    const dbRoom = await db.query.streamingRooms.findFirst({
      where: eq(streamingRooms.id, roomId)
    });
    
    if (!dbRoom || dbRoom.status === "ended") {
      socket.emit("room:join_error", { message: "Room not found" });
      return;
    }
    
    // Query current participants from DB
    const dbParticipants = await db.query.roomParticipants.findMany({
      where: and(
        eq(roomParticipants.roomId, roomId),
        isNull(roomParticipants.leftAt)
      )
    });
    
    // Rebuild in-memory state
    roomStates.set(roomId, {
      id: dbRoom.id,
      name: dbRoom.name,
      status: dbRoom.status,
      streamerId: dbRoom.streamerId,
      participants: new Map(),
      createdAt: dbRoom.createdAt,
      dbConfirmed: true
    });
    
    // Re-add existing participants
    for (const p of dbParticipants) {
      roomStates.get(roomId)!.participants.set(p.userId, {
        userId: p.userId,
        userName: p.userName, // from users table
        joinedAt: p.joinedAt,
        isMobile: false, // will be set on rejoin
        socketId: "" // will be set on rejoin
      });
    }
  }
  
  // Now add the rejoining user
  const room = roomStates.get(roomId)!;
  room.participants.set(userId, {
    userId,
    userName: socket.data.userName,
    socketId: socket.id,
    joinedAt: new Date(),
    isMobile: socket.data.isMobile || false
  });
  
  // Emit full state to rejoining user
  socket.emit("room:state_sync", {
    roomId,
    roomState: serializeRoomState(room),
    yourParticipantId: userId
  });
  
  // Notify others
  socket.to(roomId).emit("room:user_joined", {
    userId,
    userName: socket.data.userName,
    participantCount: room.participants.size,
    roomState: serializeRoomState(room)
  });
});
```

## Data Consistency

### Transaction Strategy

All critical operations use database transactions:

```typescript
// Example: Join room with status update
await db.transaction(async (trx) => {
  // 1. Insert participant
  await trx.insert(roomParticipants).values({
    roomId,
    userId,
    joinedAt: new Date()
  });
  
  // 2. Count participants
  const count = await trx.select({ count: sql<number>`count(*)` })
    .from(roomParticipants)
    .where(and(
      eq(roomParticipants.roomId, roomId),
      isNull(roomParticipants.leftAt)
    ));
  
  // 3. Update room status if needed
  if (count[0].count >= 2) {
    await trx.update(streamingRooms)
      .set({ status: "active" })
      .where(eq(streamingRooms.id, roomId));
  }
});
// Transaction ensures all-or-nothing
```

### Error Handling

**Database Write Failure:**
```typescript
try {
  await db.transaction(async (trx) => {
    // ... operations
  });
  
  // Success: Update memory + broadcast
  updateRoomState(roomId, newState);
  broadcastToRoom(roomId, "room:updated", newState);
  
} catch (error) {
  // Failure: Don't update memory, emit error
  socket.emit("room:error", { 
    message: "Operation failed. Please try again." 
  });
  // State remains consistent
}
```

### Race Condition Prevention

**Problem:** Two users join simultaneously

**Solution:**
1. Database transactions with row-level locking
2. Node.js single-threaded event loop (per server)
3. Sequential processing of room events

```typescript
// Row-level locking in PostgreSQL
await trx.execute(sql`
  SELECT * FROM streamingRooms 
  WHERE id = ${roomId} 
  FOR UPDATE
`);
// Other transactions wait for this one to complete
```

## Cleanup Strategy

### In-Memory Cleanup

```typescript
// Runs every 5 minutes
setInterval(() => {
  for (const [roomId, room] of roomStates) {
    // End empty waiting rooms after 5 minutes
    if (room.status === "waiting" && 
        room.participants.size === 0 &&
        room.createdAt < fiveMinutesAgo) {
      
      // Update database
      await db.update(streamingRooms)
        .set({ status: "ended", endedAt: new Date() })
        .where(eq(streamingRooms.id, roomId));
      
      // Remove from memory
      roomStates.delete(roomId);
      
      // Notify
      broadcastToRoom(roomId, "room:ended", { roomId });
    }
  }
}, 5 * 60 * 1000);
```

### Why Not Immediate End?

- Allows for reconnection (brief disconnects)
- Gives users time to rejoin
- Cleanup job handles it eventually

## Multi-Server Considerations (Future)

If scaling to multiple WebSocket servers:

### Option 1: Redis Pub/Sub
```typescript
// Server A publishes
redis.publish("room:update", { roomId, update });

// Server B subscribes
redis.subscribe("room:update", (msg) => {
  updateLocalState(msg.roomId, msg.update);
});
```

### Option 2: Sticky Sessions
- Load balancer routes user to same server
- Simple but limits failover

### Option 3: Shared State (Redis)
- Store roomStates in Redis
- All servers read/write to Redis
- Slightly higher latency

**Current Implementation:** Single server (Node.js event loop)

## Debugging

### Enable Debug Logging

```typescript
// websocket/room-state.ts
const DEBUG = process.env.DEBUG_ROOMS === "true";

export function debugState(roomId?: string) {
  if (!DEBUG) return;
  
  if (roomId) {
    console.log(`[RoomState:${roomId}]`, roomStates.get(roomId));
  } else {
    console.log("[RoomState:All]", 
      Array.from(roomStates.entries()).map(([id, r]) => ({
        id, 
        name: r.name, 
        participants: r.participants.size 
      }))
    );
  }
}
```

### Common Issues

**1. State Desync**
```
Symptom: User sees wrong participant list
Cause: Missed WebSocket event
Fix: Client calls 'room:rejoin' to get full state sync
```

**2. Ghost Participants**
```
Symptom: User appears in room after disconnect
Cause: Disconnect not detected, cleanup not run
Fix: Heartbeat check + cleanup job
```

**3. Duplicate Joins**
```
Symptom: Same user appears twice
Cause: Race condition in join handling
Fix: Transaction with unique constraint check
```

## Migration from HTTP-First

### Phase 1: Add WebSocket Support (Parallel)
- Keep existing HTTP endpoints
- Add WebSocket events
- Frontend uses both (WebSocket for real-time, HTTP for initial load)

### Phase 2: Frontend Switch
- Remove HTTP calls for room operations
- Use WebSocket exclusively
- Add error handling for WebSocket failures

### Phase 3: Remove HTTP Endpoints
- Remove server functions
- Keep HTTP only for non-real-time operations (auth, profile, etc.)

### Phase 4: Optimize
- Add caching
- Optimize state serialization
- Add monitoring

## File Structure

```
websocket/
├── websocket-server.ts       # Main server, socket.io setup
├── websocket-room-manager.ts # Legacy room management (to be refactored)
├── room-state.ts            # ⭐ In-memory state management
├── room-events.ts           # ⭐ Event handlers (create, join, leave, rejoin)
├── db-persistence.ts        # ⭐ Database write operations
├── chat-handler.ts          # Chat events
└── utils.ts                 # Helpers

src/
├── lib/
│   └── websocket-context.tsx  # WebSocket connection + auto-rejoin
├── hooks/
│   └── useRoom.ts            # ⭐ Room state subscription
├── routes/
│   ├── room.$roomId.tsx      # Room page (WebSocket only)
│   └── index.tsx             # Room list (HTTP + WebSocket)
└── components/
    └── CreateRoomModal.tsx   # Emits 'room:create'

New files marked with ⭐
```

## Testing

### Unit Tests

```typescript
// Test in-memory state
const room = createRoomState({ name: "Test" });
expect(roomStates.has(room.id)).toBe(true);

joinRoom(room.id, userId);
expect(room.participants.has(userId)).toBe(true);
```

### Integration Tests

```typescript
// Test WebSocket events
const client = io("ws://localhost:3001");
client.emit("room:create", { name: "Test" });
client.on("room:created", (data) => {
  expect(data.room.name).toBe("Test");
});
```

### Recovery Tests

```typescript
// Simulate server restart
// 1. Create room
// 2. Join users
// 3. Restart server
// 4. Clients auto-rejoin
// 5. Verify state rebuilt correctly
```

## See Also

- [Room System](./ROOM_SYSTEM.md) - Room lifecycle
- [WebSocket Events](./WEBSOCKET_EVENTS.md) - Event reference
- [Project Structure](./PROJECT_STRUCTURE.md) - File organization
