> **Historical planning document.** This describes a manual RTCPeerConnection architecture that was never implemented. The actual implementation uses PeerJS — see [README.md](./README.md).

## 7. WebSocket Server Event Handlers

### WebRTC Namespace Setup

```typescript
// websocket/websocket-server.ts - Screen sharing WebRTC events

// Track WebRTC state per room with screen sharing context
const roomWebRTCState = new Map<string, {
  streamerId: string;
  viewerIds: Set<string>;
  transferInProgress: boolean;
  transferStartedAt?: number;
  audioMode?: AudioMode;
  screenShareActive: boolean;
}>();

// Track transfer completion
const transferCompletions = new Map<string, {
  expectedViewers: Set<string>;
  reconnectedViewers: Set<string>;
  startedAt: number;
}>();

// Screen sharing ended handler (CRITICAL - immediate response)
socket.on('webrtc:screen_share_ended', async (data: {
  roomId: string;
  reason: 'user_stopped_sharing' | 'browser_stopped' | 'manual_stop';
  timestamp: number;
}) => {
  const { roomId, reason } = data;
  const userId = socket.data.userId;
  
  console.log(`[WebRTC] Screen share ended by ${userId} in room ${roomId}, reason: ${reason}`);
  
  // IMMEDIATE action - don't wait
  const roomState = roomWebRTCState.get(roomId);
  if (!roomState || roomState.streamerId !== userId) {
    console.warn(`[WebRTC] Screen share ended event from non-streamer or unknown room`);
    return;
  }
  
  // Mark screen share as inactive
  roomState.screenShareActive = false;
  
  // Notify all room members immediately
  io.to(roomId).emit('webrtc:screen_share_ended', {
    streamerId: userId,
    reason,
    timestamp: Date.now(),
  });
  
  // Initiate transfer if viewers present
  const participants = await getRoomParticipants(roomId);
  const viewers = participants.filter(p => p.userId !== userId);
  
  if (viewers.length > 0) {
    console.log(`[WebRTC] Initiating transfer after screen share ended`);
    
    // Find earliest viewer
    const earliestViewer = viewers.sort((a, b) => 
      new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
    )[0];
    
    // Initiate transfer
    initiateScreenShareTransfer(roomId, userId, earliestViewer.userId, reason);
  } else {
    // No viewers - set room to waiting
    console.log(`[WebRTC] No viewers, setting room to waiting`);
    roomWebRTCState.delete(roomId);
    
    await db.update(streamingRooms)
      .set({ streamerId: null, status: 'waiting' })
      .where(eq(streamingRooms.id, roomId));
    
    io.to(roomId).emit('room:status_changed', { status: 'waiting' });
  }
});

// Streamer ready handler (after explicit opt-in)
socket.on('webrtc:streamer_ready', async (data: {
  roomId: string;
  audioMode: AudioMode;
}) => {
  const { roomId, audioMode } = data;
  const userId = socket.data.userId;
  
  console.log(`[WebRTC] Streamer ${userId} ready in room ${roomId} with audio mode: ${audioMode}`);
  
  // Update room state
  const state = roomWebRTCState.get(roomId);
  if (state) {
    state.transferInProgress = false;
    state.screenShareActive = true;
    state.audioMode = audioMode;
    state.streamerId = userId;
  } else {
    // New stream, not transfer
    roomWebRTCState.set(roomId, {
      streamerId: userId,
      viewerIds: new Set(),
      transferInProgress: false,
      screenShareActive: true,
      audioMode,
    });
  }
  
  // Notify all room members
  io.to(roomId).emit('webrtc:streamer_ready', {
    streamerId: userId,
    streamerName: socket.data.userName,
    audioMode,
  });
  
  // Trigger viewer reconnection after delay
  setTimeout(() => {
    const currentState = roomWebRTCState.get(roomId);
    if (!currentState?.transferInProgress) {
      io.to(roomId).emit('webrtc:reconnect_now', {
        newStreamerId: userId,
        newStreamerName: socket.data.userName,
        streamerSocketId: socket.id,
        audioEnabled: audioMode !== 'silent',
      });
      
      // Start tracking transfer completion
      const participants = getRoomParticipants(roomId);
      const viewerIds = participants
        .filter(p => p.userId !== userId)
        .map(p => p.userId);
      
      transferCompletions.set(roomId, {
        expectedViewers: new Set(viewerIds),
        reconnectedViewers: new Set(),
        startedAt: Date.now(),
      });
    }
  }, 500);
});

// Connection established tracking
socket.on('webrtc:connection_established', (data: {
  roomId: string;
  streamerId: string;
  timestamp: number;
}) => {
  const { roomId, streamerId } = data;
  const viewerId = socket.data.userId;
  
  const completion = transferCompletions.get(roomId);
  if (completion) {
    completion.reconnectedViewers.add(viewerId);
    
    // Check if all viewers connected
    const allConnected = [...completion.expectedViewers].every(
      id => completion.reconnectedViewers.has(id)
    );
    
    if (allConnected) {
      const duration = Date.now() - completion.startedAt;
      console.log(`[WebRTC] Transfer complete in room ${roomId}, duration: ${duration}ms`);
      
      io.to(roomId).emit('webrtc:transfer_complete', {
        duration,
        viewerCount: completion.reconnectedViewers.size,
      });
      
      transferCompletions.delete(roomId);
    }
  }
});

// Forward WebRTC signaling messages
socket.on('webrtc:offer', (data: {
  roomId: string;
  toUserId: string;
  offer: RTCSessionDescriptionInit;
  isIceRestart?: boolean;
}) => {
  const { roomId, toUserId, offer, isIceRestart } = data;
  const fromUserId = socket.data.userId;
  
  // Find target socket
  for (const [socketId, userData] of socketUserMap.entries()) {
    if (userData.userId === toUserId && userData.roomId === roomId) {
      io.to(socketId).emit('webrtc:offer', {
        fromUserId,
        fromUserName: socket.data.userName,
        offer,
        isIceRestart,
      });
      break;
    }
  }
});

socket.on('webrtc:answer', (data: {
  roomId: string;
  toUserId: string;
  answer: RTCSessionDescriptionInit;
  isIceRestart?: boolean;
}) => {
  const { roomId, toUserId, answer, isIceRestart } = data;
  const fromUserId = socket.data.userId;
  
  for (const [socketId, userData] of socketUserMap.entries()) {
    if (userData.userId === toUserId && userData.roomId === roomId) {
      io.to(socketId).emit('webrtc:answer', {
        fromUserId,
        answer,
        isIceRestart,
      });
      break;
    }
  }
});

socket.on('webrtc:ice_restart_offer', (data: {
  roomId: string;
  offer: RTCSessionDescriptionInit;
}) => {
  const { roomId, offer } = data;
  const fromUserId = socket.data.userId;
  
  // Forward to streamer
  const roomState = roomWebRTCState.get(roomId);
  if (roomState) {
    for (const [socketId, userData] of socketUserMap.entries()) {
      if (userData.userId === roomState.streamerId && userData.roomId === roomId) {
        io.to(socketId).emit('webrtc:ice_restart_offer', {
          fromUserId,
          offer,
        });
        break;
      }
    }
  }
});

socket.on('webrtc:ice-candidate', (data: {
  roomId: string;
  toUserId: string;
  candidate: RTCIceCandidateInit;
}) => {
  const { roomId, toUserId, candidate } = data;
  const fromUserId = socket.data.userId;
  
  for (const [socketId, userData] of socketUserMap.entries()) {
    if (userData.userId === toUserId && userData.roomId === roomId) {
      io.to(socketId).emit('webrtc:ice-candidate', {
        fromUserId,
        candidate,
      });
      break;
    }
  }
});

// Audio mute state change
socket.on('webrtc:audio_mute_changed', (data: {
  roomId: string;
  isMuted: boolean;
}) => {
  const { roomId, isMuted } = data;
  const streamerId = socket.data.userId;
  
  // Forward to all viewers
  io.to(roomId).emit('webrtc:audio_mute_changed', {
    streamerId,
    isMuted,
  });
});
```

### Screen Share Transfer Handler

```typescript
// Initiate transfer when streamer leaves or stops sharing
async function initiateScreenShareTransfer(
  roomId: string,
  oldStreamerId: string,
  newStreamerId: string,
  reason: string
): Promise<void> {
  console.log(`[WebRTC] Initiating screen share transfer in room ${roomId}`);
  
  // Get current room state
  const roomState = roomWebRTCState.get(roomId);
  const previousAudioMode = roomState?.audioMode;
  
  // Update room state
  roomWebRTCState.set(roomId, {
    streamerId: newStreamerId,
    viewerIds: new Set(), // Will be populated by reconnections
    transferInProgress: true,
    transferStartedAt: Date.now(),
    screenShareActive: false, // Will be set when new streamer starts
    audioMode: previousAudioMode, // Remember for new streamer
  });
  
  // Get participants for viewer list
  const participants = await getRoomParticipants(roomId);
  const viewers = participants.filter(p => p.userId !== newStreamerId);
  
  // Calculate estimated reconnect time (8-15 seconds)
  const estimatedReconnectAt = Date.now() + 8000;
  
  // Notify all clients to initiate cleanup
  io.to(roomId).emit('webrtc:transfer_initiating', {
    oldStreamerId,
    newStreamerId,
    reason,
    estimatedReconnectAt,
    wasScreenSharing: true,
    previousAudioMode,
    allParticipants: participants.map(p => ({
      userId: p.userId,
      userName: socketUserMap.get(
        [...socketUserMap.entries()]
          .find(([_, data]) => data.userId === p.userId)?.[0] || ''
      )?.userName || 'Unknown',
    })),
  });
  
  // Notify new streamer specifically
  for (const [socketId, userData] of socketUserMap.entries()) {
    if (userData.userId === newStreamerId && userData.roomId === roomId) {
      io.to(socketId).emit('webrtc:become_streamer', {
        viewers: viewers.map(v => ({
          userId: v.userId,
          userName: socketUserMap.get(
            [...socketUserMap.entries()]
              .find(([_, data]) => data.userId === v.userId)?.[0] || ''
          )?.userName || 'Unknown',
        })),
        previousAudioMode,
        showStartButton: true,
      });
      break;
    }
  }
  
  // Start transfer timeout
  startTransferTimeout(roomId);
}

// Transfer timeout handler
const TRANSFER_TIMEOUT = 20000; // 20 seconds (increased for screen sharing)

function startTransferTimeout(roomId: string): void {
  setTimeout(async () => {
    const state = roomWebRTCState.get(roomId);
    if (state?.transferInProgress) {
      console.error(`[WebRTC] Transfer timeout in room ${roomId}`);
      
      // Notify all clients of failure
      io.to(roomId).emit('webrtc:transfer_failed', {
        reason: 'timeout',
        message: 'Screen share transfer timed out. Please refresh.',
      });
      
      // Clean up state
      roomWebRTCState.delete(roomId);
      transferCompletions.delete(roomId);
      
      // Set room to waiting state
      await db.update(streamingRooms)
        .set({ streamerId: null, status: 'waiting' })
        .where(eq(streamingRooms.id, roomId));
      
      io.to(roomId).emit('room:status_changed', { status: 'waiting' });
    }
  }, TRANSFER_TIMEOUT);
}
```

### Modified Disconnect Handler with Screen Sharing

```typescript
// In websocket/websocket-server.ts - modify the disconnect handler

socket.on('disconnect', async () => {
  const socketData = socketUserMap.get(socket.id);
  if (!socketData) return;

  const { userId, userName, roomId } = socketData;
  console.log(`[Socket.io] Client disconnected: ${socket.id} (user: ${userName})`);

  // If user was in a room, handle leave
  if (roomId) {
    try {
      const room = await getRoom(roomId);
      const wasStreamer = room?.streamerId === userId;
      
      const result = await removeParticipant(roomId, userId);
      const participants = await getRoomParticipants(roomId);

      // Notify others in room
      broadcastToRoom(roomId, 'room:user_left', {
        userId,
        userName,
        participantCount: participants.length,
      });

      sendSystemMessage(roomId, `${userName} left the room`);

      if (result.newStreamerId) {
        const newStreamerName = result.newStreamerName || 'Someone';
        
        // 1. First, notify of streamer change (existing behavior)
        broadcastToRoom(roomId, 'room:streamer_changed', {
          newStreamerId: result.newStreamerId,
          newStreamerName,
        });
        sendSystemMessage(roomId, `${newStreamerName} is now the streamer`);
        
        // 2. Initiate WebRTC transfer if old streamer had active screen share
        if (wasStreamer) {
          const roomState = roomWebRTCState.get(roomId);
          
          if (roomState?.screenShareActive) {
            console.log(`[WebRTC] Initiating screen share transfer in room ${roomId}`);
            
            await initiateScreenShareTransfer(
              roomId,
              userId,
              result.newStreamerId,
              'streamer_left'
            );
          } else {
            // No active screen share - just update state
            roomWebRTCState.delete(roomId);
          }
        }
      }

      if (result.newStatus) {
        broadcastToRoom(roomId, 'room:status_changed', { status: result.newStatus });
      }
    } catch (error) {
      console.error(`[Room] Error handling disconnect:`, error);
    }
  }

  // ... rest of disconnect handler
});
```

### Debounced Transfer Handler

```typescript
// Debounce rapid streamer changes
const transferDebounces = new Map<string, NodeJS.Timeout>();

async function debouncedTransfer(
  roomId: string,
  oldStreamerId: string,
  newStreamerId: string,
  reason: string
): Promise<void> {
  // Clear any pending transfer
  const existing = transferDebounces.get(roomId);
  if (existing) {
    clearTimeout(existing);
    console.log(`[WebRTC] Cancelled pending transfer in room ${roomId}`);
  }
  
  // Debounce by 500ms to batch rapid changes
  const timeout = setTimeout(() => {
    initiateScreenShareTransfer(roomId, oldStreamerId, newStreamerId, reason);
    transferDebounces.delete(roomId);
  }, 500);
  
  transferDebounces.set(roomId, timeout);
}
```
