## 10. Edge Cases & Solutions

### Edge Case 1: New Streamer Fails to Initialize

**Scenario:** New streamer denies camera permission or their device fails.

**Solution:**
```typescript
// Server detects webrtc:streamer_ready timeout
// After 10 seconds, find next viewer and try again
async function handleStreamerInitFailure(
  roomId: string, 
  failedUserId: string
): Promise<void> {
  const participants = await getRoomParticipants(roomId);
  const nextViewer = participants.find(p => p.userId !== failedUserId);
  
  if (nextViewer) {
    // Transfer to next viewer
    await transferStreamer(roomId, failedUserId, nextViewer.userId);
  } else {
    // No other viewers - set room to waiting
    await db.update(streamingRooms)
      .set({ streamerId: null, status: 'waiting' })
      .where(eq(streamingRooms.id, roomId));
    
    io.to(roomId).emit('room:status_changed', { status: 'waiting' });
  }
}
```

### Edge Case 2: Viewer Disconnects During Transfer

**Scenario:** A viewer closes their browser while transfer is in progress.

**Solution:**
```typescript
// Server tracks which viewers have reconnected
const transferReconnections = new Map<string, Set<string>>();

// When viewer reconnects:
socket.on('webrtc:offer', (data) => {
  const roomReconnects = transferReconnections.get(data.roomId);
  if (roomReconnects) {
    roomReconnects.add(socket.data.userId);
    
    // Check if all viewers have reconnected
    const state = roomWebRTCState.get(data.roomId);
    if (state && roomReconnects.size === state.viewerIds.size) {
      console.log(`[WebRTC] All viewers reconnected in room ${data.roomId}`);
    }
  }
});
```

### Edge Case 3: Rapid Streamer Changes

**Scenario:** Streamer A leaves -> B becomes streamer -> B immediately leaves.

**Solution:**
```typescript
// Debounce transfer initiation
const transferDebounces = new Map<string, NodeJS.Timeout>();

function initiateTransfer(roomId: string, data: TransferData): void {
  // Clear any pending transfer
  const existing = transferDebounces.get(roomId);
  if (existing) {
    clearTimeout(existing);
  }
  
  // Debounce by 500ms to batch rapid changes
  const timeout = setTimeout(() => {
    executeTransfer(roomId, data);
    transferDebounces.delete(roomId);
  }, 500);
  
  transferDebounces.set(roomId, timeout);
}
```

### Edge Case 4: Network Partition

**Scenario:** Streamer and viewers are on different networks and ICE fails.

**Solution:**
```typescript
// Add TURN servers for NAT traversal
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN servers for fallback
    {
      urls: 'turn:turn.example.com:3478',
      username: 'user',
      credential: 'pass'
    }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
});
```

### Edge Case 5: Browser Compatibility

**Scenario:** Older browsers don't support WebRTC or certain features.

**Solution:**
```typescript
// Feature detection and graceful degradation
function checkWebRTCSupport(): { supported: boolean; missing: string[] } {
  const missing: string[] = [];
  
  if (!window.RTCPeerConnection) {
    missing.push('RTCPeerConnection');
  }
  
  if (!navigator.mediaDevices?.getUserMedia) {
    missing.push('getUserMedia');
  }
  
  return {
    supported: missing.length === 0,
    missing
  };
}

// In component:
const { supported, missing } = checkWebRTCSupport();

if (!supported) {
  return (
    <div className="webrtc-error">
      <p>Your browser doesn't support video streaming.</p>
      <p>Missing: {missing.join(', ')}</p>
      <p>Please use Chrome, Firefox, or Safari.</p>
    </div>
  );
}
```

### Edge Case 6: Permission Denial

**Scenario:** User denies camera/microphone permission.

**Solution:**
```typescript
async function initializeMedia(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') {
        setLastError('Camera/microphone permission denied. Please allow access.');
        // Show settings instructions
        showPermissionHelp();
      } else if (error.name === 'NotFoundError') {
        setLastError('No camera or microphone found.');
      } else {
        setLastError(`Media error: ${error.message}`);
      }
    }
    return null;
  }
}
```
