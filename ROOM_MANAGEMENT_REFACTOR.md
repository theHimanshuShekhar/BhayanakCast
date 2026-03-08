# Room Management Refactor - Socket.io Rooms Implementation

## Overview
Complete refactor of room management to use Socket.io rooms as the primary architecture, following https://socket.io/docs/v4/rooms/ best practices.

## Architecture

### Socket.io Rooms Concept
- Each room is a Socket.io channel that sockets can `join()` and `leave()`
- Broadcasting: `io.to(roomId).emit(event, data)` sends to all in room
- Excluding sender: `socket.to(roomId).emit(event, data)` sends to all except sender
- Rooms are server-only; clients don't know which rooms they're in

### Event Flow
1. **Client Action** → emits event to WebSocket server
2. **Server Processing** → updates database, manages Socket.io room membership
3. **Broadcast** → server broadcasts to all clients in the room
4. **UI Update** → clients receive event and refresh data via React Query

## WebSocket Events

### Client → Server
- `room:join` - User wants to join a room
- `room:leave` - User wants to leave a room
- `chat:send` - Send a chat message
- `streamer:transfer` - Transfer streamer ownership

### Server → Client
- `room:joined` - Confirmation of joining room (includes room state)
- `room:left` - Confirmation of leaving room
- `room:user_joined` - Another user joined
- `room:user_left` - Another user left
- `room:streamer_changed` - Streamer ownership changed
- `room:status_changed` - Room status changed
- `room:error` - Error occurred
- `chat:message` - New chat message (user or system)

## Key Changes

### WebSocket Server (`websocket-server.ts`)
- **Socket User Map**: Tracks socket -> user/room mapping
- **Join Room**: Updates DB, joins Socket.io room, broadcasts to others
- **Leave Room**: Updates DB, leaves Socket.io room, broadcasts to others
- **Chat**: Validates user is in room, broadcasts to all including sender
- **Streamer Transfer**: Validates permissions, updates DB, broadcasts change
- **Disconnect**: Auto-leaves room, updates DB, broadcasts to others

### Room Manager (`websocket-room-manager.ts`)
- `addParticipant()` - Adds user to room, handles streamer assignment
- `removeParticipant()` - Removes user, handles streamer transfer
- `transferStreamer()` - Manual streamer transfer with cooldown
- All functions return `newStreamerName` for better UX

### Room Detail Page (`src/routes/room.$roomId.tsx`)
- **WebSocket Integration**: Listens for all room events
- **Event Handlers**: Refetch data on any room change
- **Join/Leave**: Emits WebSocket events instead of server functions
- **Streamer Transfer**: Uses WebSocket instead of mutation

### WebSocket Client (`src/utils/websocket-client.ts`)
- Updated to broadcast correct event names
- `room:participant_joined` / `room:participant_left`
- Includes `userName` for better display

## Benefits

1. **Real-time Updates**: All clients see changes immediately
2. **Unified Flow**: Single source of truth via WebSocket
3. **Better UX**: System messages in chat for all room events
4. **Scalable**: Works with multiple servers (needs Redis adapter)
5. **Clean Architecture**: Separation of concerns

## Database + WebSocket Sync

### Pattern
1. WebSocket server updates database first
2. Then broadcasts to Socket.io room
3. Clients receive event and refetch
4. React Query updates UI

### Why Not Just Use WebSocket?
- Database is source of truth for persistence
- WebSocket is for real-time communication
- React Query provides caching and background updates

## Testing

All 59 tests pass:
- Room creation and joining
- Participant management
- Streamer transfer
- Chat functionality
- UI components

## Files Changed

1. `websocket-server.ts` - Complete rewrite
2. `websocket-room-manager.ts` - Added transferStreamer, updated return types
3. `src/routes/room.$roomId.tsx` - WebSocket-based room management
4. `src/utils/websocket-client.ts` - Fixed event names
5. `src/components/Chat.tsx` - Listens for room events

## Future Enhancements

- Redis adapter for multi-server scaling
- Presence indicators (who's typing)
- Room persistence across reconnects
- Message history for chat
