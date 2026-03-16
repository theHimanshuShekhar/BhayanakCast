# WebSocket Events Reference

Complete reference for Socket.io events used in BhayanakCast.

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
  |----- room:join -------->| (join specific room)
  |<---- room:joined -------|
```

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

### room:join
Join a room.

```typescript
socket.emit("room:join", { roomId: "room-456" });
```

**Rate Limit:** 10 joins per minute per user

**Responses:**
```typescript
// Success
socket.on("room:joined", (data) => {
  console.log("Joined room:", data.roomId);
  console.log("Participants:", data.participants);
});

// Already in room
socket.on("room:joined", (data) => {
  if (data.alreadyInRoom) {
    console.log("Already in this room");
  }
});

// Error
socket.on("room:error", (data) => {
  console.error("Failed to join:", data.message);
});
```

### room:leave
Leave a room.

```typescript
socket.emit("room:leave", { roomId: "room-456" });
```

**Rate Limit:** 5 leaves per minute per user

**Note:** Leaving a room automatically happens when joining another room.

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
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
});
```

### userCount
Total connected users (broadcast periodically).

```typescript
socket.on("userCount", (data) => {
  console.log("Total online users:", data.count);
});
```

### room:user_joined
Someone joined the room.

```typescript
socket.on("room:user_joined", (data) => {
  console.log(`${data.userName} joined`);
  console.log("Total participants:", data.participantCount);
});
```

**Data:**
```typescript
{
  userId: string;
  userName: string;
  participantCount: number;
}
```

### room:user_left
Someone left the room.

```typescript
socket.on("room:user_left", (data) => {
  console.log(`${data.userName} left`);
  console.log("Total participants:", data.participantCount);
});
```

### room:streamer_changed
Streamer ownership transferred.

```typescript
socket.on("room:streamer_changed", (data) => {
  console.log("New streamer:", data.newStreamerName);
  console.log("Streamer ID:", data.newStreamerId);
});
```

### room:status_changed
Room status updated.

```typescript
socket.on("room:status_changed", (data) => {
  console.log("Room status:", data.status);
  // "waiting" | "preparing" | "active" | "ended"
});
```

### chat:message
New chat message.

```typescript
socket.on("chat:message", (message) => {
  if (message.type === "user") {
    console.log(`${message.userName}: ${message.content}`);
  } else if (message.type === "system") {
    console.log("System:", message.content);
  }
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

### room:error
Room operation error.

```typescript
socket.on("room:error", (data) => {
  console.error("Room error:", data.message);
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

// Transfer cooldown
{ message: "Transfer cooldown active. Try again in 25 seconds." }

// Not authorized
{ message: "Only the streamer can transfer ownership" }
```

## Event Sequence Examples

### User Joins Room

```
Client A (Joiner)          Server                    Room Members
     |                        |                            |
     |--- room:join -------->|                            |
     |                        |--- room:user_joined ----->|
     |                        |   (broadcast to room)      |
     |<-- room:joined --------|                            |
     |                        |                            |
     |<-- room:status_changed | (if 2nd user)             |
     |   ("active")           |                            |
```

### Streamer Leaves

```
Client A (Streamer)        Server                    Client B (Viewer)
     |                        |                            |
     |--- room:leave ------->|                            |
     |                        |--- room:user_left ------->|
     |                        |   (broadcast)              |
     |                        |--- room:streamer_changed->|
     |                        |   (B is now streamer)      |
     |                        |--- chat:message --------->|
     |                        |   ("B is now streamer")    |
     |<-- (disconnect)        |                            |
```

### Chat Flow

```
Client A                   Server                    Room Members
     |                        |                            |
     |--- chat:send -------->|                            |
     |                        |--- (profanity filter)      |
     |                        |--- chat:message --------->|
     |                        |   (broadcast to room)      |
     |<-- chat:message -------|   (echo to sender)         |
```

## TypeScript Types

```typescript
// Socket events interface
interface ServerToClientEvents {
  userCount: (data: { count: number }) => void;
  identified: (data: { userId: string; userName: string }) => void;
  "room:joined": (data: { roomId: string; participants: any[]; alreadyInRoom?: boolean }) => void;
  "room:user_joined": (data: { userId: string; userName: string; participantCount: number }) => void;
  "room:user_left": (data: { userId: string; userName: string; participantCount: number }) => void;
  "room:streamer_changed": (data: { newStreamerId: string; newStreamerName: string }) => void;
  "room:status_changed": (data: { status: RoomStatus }) => void;
  "chat:message": (message: ChatMessage) => void;
  "chat:error": (data: { message: string; retryAfter?: number }) => void;
  "room:error": (data: { message: string }) => void;
}

interface ClientToServerEvents {
  identify: (data: { userId?: string; userName?: string; userImage?: string | null }) => void;
  "room:join": (data: { roomId: string }) => void;
  "room:leave": (data: { roomId: string }) => void;
  "chat:send": (data: { roomId: string; content: string }) => void;
  "streamer:transfer": (data: { roomId: string; newStreamerId: string }) => void;
}
```

## Implementation Notes

### Socket Context (React)

```typescript
// src/lib/websocket-context.tsx
const WebSocketContext = createContext<WebSocketContextType>(null);

export function WebSocketProvider({ children }) {
  const [socket, setSocket] = useState<Socket>();
  
  useEffect(() => {
    const newSocket = io(import.meta.env.VITE_WS_URL);
    setSocket(newSocket);
    
    return () => {
      newSocket.close();
    };
  }, []);
  
  return (
    <WebSocketContext.Provider value={{ socket }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export const useWebSocket = () => useContext(WebSocketContext);
```

### Using in Components

```typescript
function Chat({ roomId }) {
  const { socket } = useWebSocket();
  const [messages, setMessages] = useState([]);
  
  useEffect(() => {
    if (!socket) return;
    
    socket.on("chat:message", (message) => {
      setMessages(prev => [...prev, message]);
    });
    
    return () => {
      socket.off("chat:message");
    };
  }, [socket]);
  
  const sendMessage = (content: string) => {
    socket?.emit("chat:send", { roomId, content });
  };
  
  return (...);
}
```

## See Also

- [Room System](./ROOM_SYSTEM.md) - Room lifecycle and business logic
- [Rate Limiting](./RATE_LIMITING.md) - Rate limit configurations
- [Project Structure](./PROJECT_STRUCTURE.md) - WebSocket server files
