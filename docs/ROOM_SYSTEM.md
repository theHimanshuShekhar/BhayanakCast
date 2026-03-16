# Room System

Complete guide to rooms, their lifecycle, and business logic.

## Room Status States

Rooms progress through 4 states:

| Status | Description | Visual | Transition |
|--------|-------------|--------|------------|
| **waiting** | Room created, no streamer | Gray dot | Join → preparing |
| **preparing** | Streamer present, < 2 viewers | Yellow dot | 2nd join → active |
| **active** | Live streaming (2+ people) | Green dot + LIVE | Last leave → waiting |
| **ended** | Room closed | History icon | 5 min empty → ended |

## Room Lifecycle

### 1. Creation
```
User clicks "Create Room"
    ↓
Room created with status: "waiting"
    ↓
Creator auto-joins as first participant
    ↓
Status changes to "preparing"
```

### 2. Joining
```
User joins room
    ↓
If status = waiting → becomes streamer
    ↓
If 2nd participant → status becomes active
    ↓
Broadcast: room:user_joined, room:status_changed
```

### 3. Leaving
```
User leaves room
    ↓
Calculate watch time (joinedAt → now)
    ↓
If streamer left → transfer to earliest viewer
    ↓
If last participant → status = waiting
    ↓
Broadcast: room:user_left, room:streamer_changed
```

### 4. Cleanup
```
Room in waiting status
    ↓
Empty for 5 minutes
    ↓
Cleanup job runs (every minute)
    ↓
Status changes to ended
    ↓
Room visible in "Past Streams" for 3 hours
```

## Business Rules

### Streamer Transfer
When the streamer leaves:
1. Find earliest remaining participant (by joinedAt)
2. Transfer streamerId to that user
3. Broadcast `room:streamer_changed` event
4. Send system message: "{name} is now the streamer"

**Cooldown:** 30 seconds between transfers (prevents abuse)

```typescript
// Transfer logic
const nextViewer = await db
  .select()
  .from(roomParticipants)
  .where(
    and(
      eq(roomParticipants.roomId, roomId),
      isNull(roomParticipants.leftAt)
    )
  )
  .orderBy(asc(roomParticipants.joinedAt))
  .limit(1);

if (nextViewer.length > 0) {
  await db.update(streamingRooms)
    .set({ streamerId: nextViewer[0].userId })
    .where(eq(streamingRooms.id, roomId));
}
```

### Single Room Rule
Users can only be in **ONE** room at a time:

```typescript
// When joining new room, leave current room first
const currentRoom = await db
  .select()
  .from(roomParticipants)
  .where(
    and(
      eq(roomParticipants.userId, userId),
      isNull(roomParticipants.leftAt)
    )
  );

if (currentRoom.length > 0) {
  await leaveRoom(currentRoom[0].roomId, userId);
}
await joinRoom(newRoomId, userId);
```

### Room Activation
A room becomes "active" when:
- Status is "preparing" AND
- 2nd participant joins

```typescript
const participantCount = await db
  .select({ count: sql<number>`count(*)` })
  .from(roomParticipants)
  .where(
    and(
      eq(roomParticipants.roomId, roomId),
      isNull(roomParticipants.leftAt)
    )
  );

if (participantCount[0].count >= 2 && room.status === "preparing") {
  await db.update(streamingRooms)
    .set({ status: "active" })
    .where(eq(streamingRooms.id, roomId));
}
```

## Room Display

### Room Card States

```typescript
// Room status indicators
const isActive = room.status === "active" && !!room.streamerName;
const isEnded = room.status === "ended";

// Live indicator
{isActive && (
  <div className="flex items-center gap-1.5">
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute h-full w-full rounded-full bg-red-400" />
      <span className="relative rounded-full h-2.5 w-2.5 bg-red-500" />
    </span>
    <span className="text-xs font-medium text-red-400">LIVE</span>
  </div>
)}
```

### Ended Rooms

Ended rooms are shown in "Past Streams" section:
- Visible for 3 hours after ending
- Shows participant avatars
- Shows duration (createdAt → endedAt)

## Socket.io Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `room:join` | `{ roomId: string }` | Join a room |
| `room:leave` | `{ roomId: string }` | Leave a room |
| `chat:send` | `{ roomId: string, content: string }` | Send chat |
| `streamer:transfer` | `{ roomId: string, newStreamerId: string }` | Transfer ownership |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `room:joined` | `{ roomId: string, participants: [] }` | Successfully joined |
| `room:user_joined` | `{ userId, userName, participantCount }` | Someone joined |
| `room:user_left` | `{ userId, userName, participantCount }` | Someone left |
| `room:streamer_changed` | `{ newStreamerId, newStreamerName }` | Streamer changed |
| `room:status_changed` | `{ status: string }` | Room status updated |
| `chat:message` | `{ id, userId, userName, content, timestamp }` | New message |
| `chat:error` | `{ message: string }` | Chat error |

## Rate Limits

Room operations have rate limits to prevent abuse:

| Operation | Limit | Window |
|-----------|-------|--------|
| Create room | 3 | 60 seconds |
| Join room | 10 | 60 seconds |
| Leave room | 5 | 60 seconds |
| Transfer streamer | 1 | 30 seconds |

See [Rate Limiting](./RATE_LIMITING.md) for details.

## Cleanup Job

Runs every minute to end inactive rooms:

```typescript
// Pseudo-code for cleanup
const inactiveRooms = await db
  .select()
  .from(streamingRooms)
  .where(
    and(
      eq(streamingRooms.status, "waiting"),
      sql`${streamingRooms.streamerId} IS NULL`,
      sql`${streamingRooms.createdAt} < NOW() - INTERVAL '5 minutes'`
    )
  );

for (const room of inactiveRooms) {
  await db.update(streamingRooms)
    .set({ status: "ended", endedAt: new Date() })
    .where(eq(streamingRooms.id, room.id));
  
  broadcastRoomEnded(room.id);
}
```

## See Also

- [Database Schema](./DATABASE_SCHEMA.md) - Table definitions
- [WebSocket Events](./WEBSOCKET_EVENTS.md) - Complete event reference
- [Rate Limiting](./RATE_LIMITING.md) - Rate limit configurations
