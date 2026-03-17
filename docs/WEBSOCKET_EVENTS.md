# WebSocket Events Reference

Complete reference for Socket.io events used in BhayanakCast.

**Architecture Note:** WebSocket server maintains primary room state in memory. All operations go through WebSocket with synchronous database persistence.

## Connection

### Connection Flow

```
Client                    Server
  |                         |
  |----- connect() -------->|
  |                         |
  |<---- connection --------|
  |                         |
  |----- identify --------->| (optional, for auth)
  |<---- identified --------|
  |                         |
  |----- room:create ------>|
  |<---- room:created ------| (after DB confirmation)
  |                         |
  |----- room:join -------->|
  |<---- room:joined -------| (after DB confirmation)
```

### Reconnection Flow

**Automatic state recovery after server restart:**

```
Client                    Server
  |                         |
  |----- connect() -------->|
  |                         |
  |----- identify --------->|
  |<---- identified --------|
  |                         |
  |----- room:rejoin ------>|
  |<---- room:state_sync ---| (full room state)
  |<---- room:user_joined --| (broadcast to others)
```

**Client automatically emits `room:rejoin` on reconnection if they were in a room.**

### Rate Limiting

WebSocket connections are rate limited:
- **Limit:** 30 connections per minute per IP
- **Exceeded:** Connection rejected with error event

## Client → Server Events

### identify

Send user information after connecting.

```typescript
socket.emit("identify", {
  userId: "user-123",
  userName: "Alice",
  userImage: "https://example.com/avatar.png"
});
```

**Response:**
```typescript
socket.on("identified", (data) => {
  console.log("Identified as:", data.userId, data.userName);
});
```

---

### room:create

**NEW:** Create a new room via WebSocket.

```typescript
socket.emit("room:create", {
  name: "My Stream",
  description: "Streaming some gaming"
});
```

**Rate Limit:** 3 creates per 60 seconds per user

**Flow:**
1. WebSocket validates input
2. WebSocket inserts to database (SYNCHRONOUS - waits)
3. On success: Creates in-memory state, broadcasts to room
4. On failure: Returns error, no state created

**Success Response:**
```typescript
socket.on("room:created", (data) => {
  console.log("Room created:", data.room.id);
  console.log("You are the streamer");
  // Redirect to room page
});
```

**Error Response:**
```typescript
socket.on("room:create_error", (data) => {
  console.error("Failed to create room:", data.message);
  // Show error to user
});
```

**Data Structure:**
```typescript
{
  room: {
    id: string;
    name: string;
    description?: string;
    status: "waiting" | "preparing" | "active" | "ended";
    streamerId: string | null;
    createdAt: Date;
  };
  participant: {
    userId: string;
    userName: string;
    joinedAt: Date;
    isStreamer: boolean;
  };
}
```

---

### room:join

Join an existing room.

```typescript
socket.emit("room:join", { roomId: "room-456" });
```

**Rate Limit:** 10 joins per 60 seconds per user

**Flow:**
1. Check in-memory state (room must exist and not be ended)
2. If already in another room, auto-leave that room first
3. Insert participant to database (SYNCHRONOUS - waits)
4. On success: Update in-memory state, broadcast
5. On failure: Return error

**Success Response:**
```typescript
socket.on("room:joined", (data) => {
  console.log("Joined room:", data.roomId);
  console.log("Full room state:", data.roomState);
  console.log("You are streamer:", data.participant.isStreamer);
});
```

**Error Response:**
```typescript
socket.on("room:join_error", (data) => {
  console.error("Failed to join:", data.message);
});
```

**Data Structure:**
```typescript
{
  roomId: string;
  participant: {
    userId: string;
    userName: string;
    joinedAt: Date;
    isStreamer: boolean;
  };
  roomState: {
    id: string;
    name: string;
    description?: string;
    status: string;
    streamerId: string | null;
    participants: Participant[];
    createdAt: Date;
  };
}
```

---

### room:leave

Leave a room.

```typescript
socket.emit("room:leave", { roomId: "room-456" });
```

**Rate Limit:** 5 leaves per 60 seconds per user

**Note:** Leaving automatically happens when:
- User joins another room
- User disconnects
- Server detects stale connection

**Broadcast to Room:**
```typescript
socket.on("room:user_left", (data) => {
  console.log(`${data.userName} left`);
  console.log("Remaining:", data.participantCount);
  if (data.newStreamerId) {
    console.log("New streamer:", data.newStreamerId);
  }
});
```

---

### room:rejoin

**NEW:** Reconnect and rebuild room state after server restart or reconnection.

```typescript
// Automatically called by client on reconnect if was in room
socket.emit("room:rejoin", {
  roomId: "room-456",
  userId: "user-123"
});
```

**Rate Limit:** None (required for recovery)

**Scenarios:**

**A. Room exists in memory:**
- Add participant back
- Emit `room:state_sync` to rejoining user
- Broadcast `room:user_joined` to others

**B. Room doesn't exist (server restarted):**
- Query database for room
- Query database for current participants
- Rebuild RoomState in memory
- Add rejoining participant
- Emit `room:state_sync` to rejoining user
- Broadcast `room:user_joined` to others

**Success Response:**
```typescript
socket.on("room:state_sync", (data) => {
  console.log("State synced:", data.roomState);
  // Update entire room state from server
});
```

**Data Structure:**
```typescript
{
  roomId: string;
  roomState: {
    id: string;
    name: string;
    description?: string;
    status: string;
    streamerId: string | null;
    participants: Participant[];
    createdAt: Date;
  };
  yourParticipantId: string;
}
```

---

### chat:send

Send a chat message.

```typescript
socket.emit("chat:send", {
  roomId: "room-456",
  content: "Hello everyone!"
});
```

**Rate Limit:** 
- 30 messages per 15 seconds
- 5 rapid messages per 3 seconds

**Profanity Filter:** Messages are checked and filtered before broadcast.

**Response:**
```typescript
// Success - broadcast to all room members
socket.on("chat:message", (message) => {
  console.log(`${message.userName}: ${message.content}`);
});

// Error (rate limited)
socket.on("chat:error", (data) => {
  console.error("Chat failed:", data.message);
  console.log("Retry after:", data.retryAfter, "seconds");
});
```

---

### streamer:transfer

Transfer streamer ownership.

```typescript
socket.emit("streamer:transfer", {
  roomId: "room-456",
  newStreamerId: "user-789"
});
```

**Rate Limit:** 1 transfer per 30 seconds per room

**Requirements:**
- Must be current streamer
- New streamer must be in room
- Room must be active or preparing

**Responses:**
```typescript
// Success
socket.on("room:streamer_changed", (data) => {
  console.log(`${data.newStreamerName} is now the streamer`);
});

// System message
socket.on("chat:message", (message) => {
  if (message.type === "system") {
    console.log("System:", message.content);
    // "Bob is now the streamer"
  }
});

// Error
socket.on("room:error", (data) => {
  console.error("Transfer failed:", data.message);
});
```

## Server → Client Events

### connection / disconnect

Base Socket.io events.

```typescript
socket.on("connect", () => {
  console.log("Connected with ID:", socket.id);
  
  // If was in room before disconnect, auto-rejoin
  if (currentRoomId && currentUserId) {
    socket.emit("room:rejoin", { 
      roomId: currentRoomId, 
      userId: currentUserId 
    });
  }
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
  // Server will auto-remove user after timeout
});
```

---

### room:created

**NEW:** Room created successfully.

```typescript
socket.on("room:created", (data) => {
  console.log("Room created:", data.room);
  // Navigate to room page
  navigate({ to: "/room/$roomId", params: { roomId: data.room.id } });
});
```

---

### room:create_error

**NEW:** Room creation failed.

```typescript
socket.on("room:create_error", (data) => {
  console.error("Create error:", data.message);
  // Show error notification
});
```

---

### room:joined

Successfully joined room.

```typescript
socket.on("room:joined", (data) => {
  console.log("Joined:", data.roomId);
  console.log("Participants:", data.roomState.participants);
  console.log("You are streamer:", data.participant.isStreamer);
  
  // Initialize room state
  setRoomState(data.roomState);
  setIsStreamer(data.participant.isStreamer);
});
```

---

### room:join_error

**NEW:** Failed to join room.

```typescript
socket.on("room:join_error", (data) => {
  console.error("Join error:", data.message);
  // Show error, redirect to home
});
```

---

### room:state_sync

**NEW:** Full room state synchronization (for rejoins).

```typescript
socket.on("room:state_sync", (data) => {
  console.log("State synced:", data.roomState);
  
  // Replace entire room state
  setRoomState(data.roomState);
  
  // Check if you're streamer
  const me = data.roomState.participants.find(
    p => p.userId === currentUserId
  );
  setIsStreamer(me?.userId === data.roomState.streamerId);
});
```

**Use Case:** Server restart recovery, initial state load

---

### room:user_joined

Someone joined the room.

```typescript
socket.on("room:user_joined", (data) => {
  console.log(`${data.userName} joined`);
  console.log("Total participants:", data.participantCount);
  
  // Update room state
  addParticipant(data.userId, data.userName);
});
```

**Data:**
```typescript
{
  userId: string;
  userName: string;
  participantCount: number;
  roomState: RoomState; // Full state for sync
}
```

---

### room:user_left

Someone left the room.

```typescript
socket.on("room:user_left", (data) => {
  console.log(`${data.userName} left`);
  console.log("Remaining:", data.participantCount);
  
  if (data.newStreamerId) {
    console.log("New streamer:", data.newStreamerName);
    setStreamer(data.newStreamerId, data.newStreamerName);
  }
  
  removeParticipant(data.userId);
});
```

**Data:**
```typescript
{
  userId: string;
  userName: string;
  participantCount: number;
  newStreamerId?: string;
  newStreamerName?: string;
  roomState: RoomState;
}
```

---

### room:streamer_changed

Streamer ownership transferred.

```typescript
socket.on("room:streamer_changed", (data) => {
  console.log("New streamer:", data.newStreamerName);
  setStreamer(data.newStreamerId, data.newStreamerName);
  
  // If you're the new streamer
  if (data.newStreamerId === currentUserId) {
    showNotification("You are now the streamer!");
  }
});
```

---

### room:status_changed

Room status updated.

```typescript
socket.on("room:status_changed", (data) => {
  console.log("Room status:", data.status);
  // "waiting" | "preparing" | "active" | "ended"
  
  setRoomStatus(data.status);
  
  if (data.status === "ended") {
    // Room ended, redirect to home
    navigate({ to: "/" });
  }
});
```

---

### room:ended

**NEW:** Room has been ended by cleanup job.

```typescript
socket.on("room:ended", (data) => {
  console.log("Room ended:", data.roomId);
  showNotification("This room has ended");
  navigate({ to: "/" });
});
```

---

### chat:message

New chat message.

```typescript
socket.on("chat:message", (message) => {
  if (message.type === "user") {
    console.log(`${message.userName}: ${message.content}`);
  } else if (message.type === "system") {
    console.log("System:", message.content);
  }
  
  addMessage(message);
});
```

**Message Structure:**
```typescript
{
  id: string;              // Unique message ID
  roomId: string;          // Room ID
  userId: string;          // Sender ID
  userName: string;        // Sender name
  userImage?: string;      // Sender avatar
  content: string;         // Message text (filtered)
  timestamp: number;       // Unix timestamp
  type: "user" | "system"; // Message type
}
```

---

### chat:error

Chat error (rate limit, empty message, etc.).

```typescript
socket.on("chat:error", (data) => {
  console.error("Chat error:", data.message);
  if (data.retryAfter) {
    console.log(`Wait ${data.retryAfter} seconds`);
  }
});
```

---

### room:error

Room operation error.

```typescript
socket.on("room:error", (data) => {
  console.error("Room error:", data.message);
});
```

---

### userCount

Total connected users (broadcast periodically).

```typescript
socket.on("userCount", (data) => {
  console.log("Total online users:", data.count);
});
```

## Error Handling

### Common Errors

```typescript
// Rate limit exceeded
{ message: "You're sending messages too quickly. Try again in 12 seconds.", retryAfter: 12 }

// Not authenticated
{ message: "Not authenticated" }

// Not in room
{ message: "You must join the room first" }

// Room not found
{ message: "Room not found" }

// Room already ended
{ message: "Room has already ended" }

// Transfer cooldown
{ message: "Transfer cooldown active. Try again in 25 seconds." }

// Not authorized
{ message: "Only the streamer can transfer ownership" }

// Already in room
{ message: "You're already in this room" }

// Database error (rare)
{ message: "Failed to save to database. Please try again." }
```

## Event Sequence Examples

### Room Creation

```
Client A (Creator)         Server
     |                        |
     |--- room:create ------->|
     |                        | (validate, insert to DB)
     |                        | (wait for DB confirmation)
     |<-- room:created -------|
     |                        | (room in memory, dbConfirmed: true)
     |                        |
     |--- room:join --------->|
     |<-- room:joined --------|
     |                        | (A is participant and streamer)
```

### User Joins Room

```
Client A (Joiner)          Server                    Room Members
     |                        |                            |
     |--- room:join --------->|                            |
     |                        | (check in-memory state)    |
     |                        | (insert to DB)             |
     |                        | (wait for confirmation)    |
     |<-- room:joined --------|                            |
     |   (full state)         |                            |
     |                        |--- room:user_joined ----->|
     |                        |   (broadcast, full state)  |
     |                        |                            |
     |<-- room:status_changed | (if 2nd user)             |
     |   ("active")           |                            |
```

### Server Restart Recovery

```
Server Restarts
     |
     | (roomStates is empty)
     |
Client A (was in room)     Server                    Client B
     |                        |                            |
     |----- connect() ------->|                            |
     |                        |                            |
     |----- identify -------->|                            |
     |<---- identified --------|                            |
     |                        |                            |
     |--- room:rejoin ------->|                            |
     |   {roomId, userId}     |                            |
     |                        | (room not in memory)       |
     |                        | (query DB)                 |
     |                        | (rebuild state)            |
     |<-- room:state_sync ----|                            |
     |   (full room state)    |                            |
     |                        |--- room:user_joined ----->|
     |                        |   (A has rejoined)         |
     |                        |                            |
Client B also calls room:rejoin
     |                        |                            |
     |                        |<-- room:rejoin ------------|
     |                        | (room now exists)          |
     |                        |--- room:state_sync ------->|
     |                        |--- room:user_joined ----->|
     |                        |   (B has rejoined)         |
```

### Streamer Leaves with Transfer

```
Client A (Streamer)        Server                    Client B (Viewer)
     |                        |                            |
     |--- room:leave -------->|                            |
     |                        | (DB transaction)           |
     |                        | - Mark A as left           |
     |                        | - Transfer to B            |
     |<-- (ack)               |                            |
     |                        |--- room:user_left ------->|
     |                        |   (A left, count: 1)       |
     |                        |--- room:streamer_changed->|
     |                        |   (B is now streamer)      |
     |                        |--- chat:message --------->|
     |                        |   ("B is now the streamer")|
     |                        |                            |
     | (disconnects)          |                            |
```

## TypeScript Types

```typescript
// Socket events interface
interface ServerToClientEvents {
  userCount: (data: { count: number }) => void;
  identified: (data: { userId: string; userName: string }) => void;
  
  // Room management
  "room:created": (data: { room: Room; participant: Participant }) => void;
  "room:create_error": (data: { message: string }) => void;
  "room:joined": (data: { roomId: string; participant: Participant; roomState: RoomState }) => void;
  "room:join_error": (data: { message: string }) => void;
  "room:state_sync": (data: { roomId: string; roomState: RoomState; yourParticipantId: string }) => void;
  "room:user_joined": (data: { userId: string; userName: string; participantCount: number; roomState: RoomState }) => void;
  "room:user_left": (data: { userId: string; userName: string; participantCount: number; newStreamerId?: string; newStreamerName?: string; roomState: RoomState }) => void;
  "room:streamer_changed": (data: { newStreamerId: string; newStreamerName: string }) => void;
  "room:status_changed": (data: { status: RoomStatus }) => void;
  "room:ended": (data: { roomId: string }) => void;
  
  // Chat
  "chat:message": (message: ChatMessage) => void;
  "chat:error": (data: { message: string; retryAfter?: number }) => void;
  "room:error": (data: { message: string }) => void;
}

interface ClientToServerEvents {
  identify: (data: { userId?: string; userName?: string; userImage?: string | null }) => void;
  
  // Room management
  "room:create": (data: { name: string; description?: string }) => void;
  "room:join": (data: { roomId: string }) => void;
  "room:leave": (data: { roomId: string }) => void;
  "room:rejoin": (data: { roomId: string; userId: string }) => void;
  "streamer:transfer": (data: { roomId: string; newStreamerId: string }) => void;
  
  // Chat
  "chat:send": (data: { roomId: string; content: string }) => void;
}

// Types
interface RoomState {
  id: string;
  name: string;
  description?: string;
  status: "waiting" | "preparing" | "active" | "ended";
  streamerId: string | null;
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

type RoomStatus = "waiting" | "preparing" | "active" | "ended";

interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  userImage?: string;
  content: string;
  timestamp: number;
  type: "user" | "system";
}
```

## Implementation Notes

### Socket Context (React)

```typescript
// src/lib/websocket-context.tsx
const WebSocketContext = createContext<WebSocketContextType>(null);

export function WebSocketProvider({ children }) {
  const [socket, setSocket] = useState<Socket>();
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  
  useEffect(() => {
    const newSocket = io(import.meta.env.VITE_WS_URL);
    setSocket(newSocket);
    
    // Auto-rejoin on reconnect
    newSocket.on("connect", () => {
      if (currentRoomId && userId) {
        newSocket.emit("room:rejoin", { roomId: currentRoomId, userId });
      }
    });
    
    return () => {
      newSocket.close();
    };
  }, [currentRoomId, userId]);
  
  return (
    <WebSocketContext.Provider value={{ socket, currentRoomId, setCurrentRoomId }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export const useWebSocket = () => useContext(WebSocketContext);
```

### Room State Hook

```typescript
// src/hooks/useRoom.ts
export function useRoom(roomId: string) {
  const { socket, setCurrentRoomId } = useWebSocket();
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  
  useEffect(() => {
    if (!socket) return;
    
    setCurrentRoomId(roomId);
    
    // Join room
    socket.emit("room:join", { roomId });
    
    // Listen for state updates
    socket.on("room:joined", (data) => {
      setRoomState(data.roomState);
    });
    
    socket.on("room:state_sync", (data) => {
      setRoomState(data.roomState);
    });
    
    socket.on("room:user_joined", (data) => {
      setRoomState(data.roomState);
    });
    
    socket.on("room:user_left", (data) => {
      setRoomState(data.roomState);
    });
    
    return () => {
      socket.emit("room:leave", { roomId });
      socket.off("room:joined");
      socket.off("room:state_sync");
      socket.off("room:user_joined");
      socket.off("room:user_left");
    };
  }, [socket, roomId]);
  
  return { roomState };
}
```

### Creating a Room

```typescript
function CreateRoomButton() {
  const { socket } = useWebSocket();
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();
  
  const createRoom = (name: string, description?: string) => {
    if (!socket) return;
    
    setIsCreating(true);
    socket.emit("room:create", { name, description });
  };
  
  useEffect(() => {
    if (!socket) return;
    
    socket.on("room:created", (data) => {
      setIsCreating(false);
      navigate({ to: "/room/$roomId", params: { roomId: data.room.id } });
    });
    
    socket.on("room:create_error", (data) => {
      setIsCreating(false);
      showError(data.message);
    });
    
    return () => {
      socket.off("room:created");
      socket.off("room:create_error");
    };
  }, [socket]);
  
  return (
    <button onClick={() => createRoom("My Room")} disabled={isCreating}>
      {isCreating ? "Creating..." : "Create Room"}
    </button>
  );
}
```

## See Also

- [Room System](./ROOM_SYSTEM.md) - Room lifecycle and business logic
- [Rate Limiting](./RATE_LIMITING.md) - Rate limit configurations
- [Project Structure](./PROJECT_STRUCTURE.md) - WebSocket server files
- [WebSocket Architecture](./WEBSOCKET_ARCHITECTURE.md) - Server restart recovery
