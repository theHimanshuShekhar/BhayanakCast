> **Historical planning document.** This describes a manual RTCPeerConnection architecture that was never implemented. The actual implementation uses PeerJS — see [README.md](./README.md).

## 3. Socket.io Events for Screen Sharing

### Server → Client Events

```typescript
// webrtc:transfer_initiating
// Sent when streamer transfer begins
interface TransferInitiatingEvent {
  oldStreamerId: string;
  newStreamerId: string;
  reason: 'streamer_left' | 'screen_share_ended' | 'manual_transfer';
  estimatedReconnectAt: number; // timestamp (8-15 seconds)
  wasScreenSharing: true;
  previousAudioMode?: AudioMode; // Streamer's audio config
  allParticipants: Array<{
    userId: string;
    userName: string;
  }>;
}

// webrtc:become_streamer
// Sent to the new streamer (must explicitly start sharing)
interface BecomeStreamerEvent {
  viewers: Array<{
    userId: string;
    userName: string;
  }>;
  previousAudioMode?: AudioMode;
  showStartButton: true; // Must click to start
}

// webrtc:reconnect_now
// Sent to all viewers when ready to reconnect
interface ReconnectNowEvent {
  newStreamerId: string;
  newStreamerName: string;
  streamerSocketId: string;
  audioEnabled: boolean;
}

// webrtc:offer
// Forwarded offer from viewer to streamer
interface WebRTCOfferEvent {
  fromUserId: string;
  fromUserName: string;
  offer: RTCSessionDescriptionInit;
  isIceRestart?: boolean; // ICE restart offer
}

// webrtc:answer
// Forwarded answer from streamer to viewer
interface WebRTCAnswerEvent {
  fromUserId: string;
  answer: RTCSessionDescriptionInit;
  isIceRestart?: boolean;
}

// webrtc:ice-candidate
// Forwarded ICE candidate
interface WebRTCICECandidateEvent {
  fromUserId: string;
  candidate: RTCIceCandidateInit;
}

// webrtc:ice_restart_offer
// ICE restart offer (either side can initiate)
interface IceRestartOfferEvent {
  fromUserId: string;
  offer: RTCSessionDescriptionInit;
}

// webrtc:connection_failed
// Sent when connection cannot be established
interface ConnectionFailedEvent {
  targetUserId: string;
  reason: string;
  retryable: boolean;
}

// webrtc:streamer_ready
// Confirmation that streamer is broadcasting
interface StreamerReadyEvent {
  streamerId: string;
  streamerName: string;
  audioMode: AudioMode;
}

// webrtc:transfer_complete
// All viewers successfully reconnected
interface TransferCompleteEvent {
  duration: number; // Time in ms
  viewerCount: number;
}

// webrtc:screen_share_ended
// Screen sharing stopped (browser UI or manual)
interface ScreenShareEndedEvent {
  streamerId: string;
  reason: 'user_stopped_sharing' | 'browser_stopped' | 'manual_stop';
  timestamp: number;
}

// webrtc:viewer_queue_update
// During transfer, update viewers on queue status
interface ViewerQueueUpdateEvent {
  position: number;
  estimatedWait: number; // seconds
  status: 'waiting' | 'connecting' | 'connected';
}
```

### Client → Server Events

```typescript
// webrtc:streamer_ready
// New streamer confirms they're ready (after clicking Start)
interface StreamerReadyPayload {
  roomId: string;
  audioMode: AudioMode;
}

// webrtc:screen_share_ended
// Screen sharing ended via browser UI (critical event)
interface ScreenShareEndedPayload {
  roomId: string;
  reason: 'user_stopped_sharing' | 'browser_stopped' | 'manual_stop';
  timestamp: number;
}

// webrtc:offer
// Viewer sends offer to streamer
interface WebRTCOfferPayload {
  roomId: string;
  toUserId: string;
  offer: RTCSessionDescriptionInit;
  isIceRestart?: boolean;
}

// webrtc:answer
// Streamer sends answer to viewer
interface WebRTCAnswerPayload {
  roomId: string;
  toUserId: string;
  answer: RTCSessionDescriptionInit;
  isIceRestart?: boolean;
}

// webrtc:ice-candidate
// Client sends ICE candidate
interface WebRTCICECandidatePayload {
  roomId: string;
  toUserId: string;
  candidate: RTCIceCandidateInit;
}

// webrtc:connection_state
// Client reports connection state change
interface ConnectionStatePayload {
  roomId: string;
  targetUserId: string;
  state: RTCPeerConnectionState;
  timestamp: number;
}

// webrtc:audio_mute_changed
// Streamer mutes/unmutes audio
interface AudioMuteChangedPayload {
  roomId: string;
  isMuted: boolean;
}

// webrtc:connection_established
// Viewer confirms connection is working
interface ConnectionEstablishedPayload {
  roomId: string;
  streamerId: string;
  timestamp: number;
}
```

## 4. Connection Cleanup Logic

### Screen Sharing Cleanup (Critical)

```typescript
// src/hooks/useScreenShare.ts - cleanupScreenShare()

async function cleanupScreenShare(reason: 'transfer' | 'stop' | 'disconnect'): Promise<void> {
  console.log(`[ScreenShare] Cleaning up screen share (reason: ${reason})...`);
  
  // 1. Remove onended handler to prevent duplicate events
  if (screenTrack.current) {
    screenTrack.current.onended = null;
    screenTrack.current.onmute = null;
    screenTrack.current.onunmute = null;
  }
  
  // 2. Notify all viewers via data channels (if transfer)
  if (reason === 'transfer') {
    for (const [userId, peerState] of peerConnections.current.entries()) {
      try {
        if (peerState.dataChannel?.readyState === 'open') {
          peerState.dataChannel.send(JSON.stringify({
            type: 'screen-share-ending',
            message: 'Streamer is transferring',
            timestamp: Date.now(),
            estimatedReconnectAt: Date.now() + 8000,
          }));
        }
      } catch (error) {
        console.warn(`[ScreenShare] Failed to notify ${userId}:`, error);
      }
    }
    
    // Wait briefly for messages to be sent
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  // 3. Close all data channels
  for (const peerState of peerConnections.current.values()) {
    try {
      if (peerState.dataChannel) {
        peerState.dataChannel.close();
      }
    } catch (error) {
      console.warn('[ScreenShare] Error closing data channel:', error);
    }
  }
  
  // 4. Stop screen track (critical - releases browser's share indicator)
  if (screenTrack.current) {
    console.log('[ScreenShare] Stopping screen track');
    screenTrack.current.stop();
    screenTrack.current = null;
  }
  
  // 5. Stop all audio tracks
  for (const track of audioTracks.current) {
    console.log(`[ScreenShare] Stopping audio track: ${track.label}`);
    track.stop();
  }
  audioTracks.current = [];
  
  // 6. Stop all tracks in local stream
  if (localStream.current) {
    localStream.current.getTracks().forEach(track => {
      console.log(`[ScreenShare] Stopping track: ${track.kind}`);
      track.stop();
    });
    localStream.current = null;
  }
  
  // 7. Close all peer connections
  for (const [userId, peerState] of peerConnections.current.entries()) {
    try {
      console.log(`[ScreenShare] Closing connection to ${userId}`);
      
      // Remove all tracks from senders
      const senders = peerState.connection.getSenders();
      for (const sender of senders) {
        try {
          peerState.connection.removeTrack(sender);
        } catch (error) {
          // Track might already be removed
        }
      }
      
      // Close the connection
      peerState.connection.close();
    } catch (error) {
      console.warn(`[ScreenShare] Error closing connection to ${userId}:`, error);
    }
  }
  
  // 8. Clear the map
  peerConnections.current.clear();
  
  // 9. Clear video elements
  if (localVideoRef.current) {
    localVideoRef.current.srcObject = null;
  }
  
  // 10. Update state
  setIsSharing(false);
  setLocalStream(null);
  
  console.log('[ScreenShare] Cleanup complete');
}
```

### Viewer Cleanup

```typescript
// src/hooks/useScreenShare.ts - cleanupAsViewer()

async function cleanupAsViewer(reason: 'transfer' | 'disconnect'): Promise<void> {
  console.log(`[ScreenShare] Cleaning up as viewer (reason: ${reason})...`);
  
  // 1. Close data channel if open
  if (streamerConnection.current?.dataChannel) {
    try {
      if (streamerConnection.current.dataChannel.readyState === 'open') {
        streamerConnection.current.dataChannel.close();
      }
    } catch (error) {
      console.warn('[ScreenShare] Error closing data channel:', error);
    }
  }
  
  // 2. Stop all remote tracks
  if (remoteStream.current) {
    remoteStream.current.getTracks().forEach(track => {
      console.log(`[ScreenShare] Stopping remote track: ${track.kind}`);
      track.stop();
    });
    remoteStream.current = null;
  }
  
  // 3. Close peer connection
  if (streamerConnection.current?.connection) {
    try {
      console.log('[ScreenShare] Closing connection to streamer');
      streamerConnection.current.connection.close();
    } catch (error) {
      console.warn('[ScreenShare] Error closing connection:', error);
    }
    streamerConnection.current = null;
  }
  
  // 4. Clear video element
  if (remoteVideoRef.current) {
    remoteVideoRef.current.srcObject = null;
    remoteVideoRef.current.poster = '/screen-share-offline.png';
  }
  
  // 5. Update state
  if (reason === 'transfer') {
    setTransferState('cleaning_up');
  } else {
    setConnectionStatus('disconnected');
  }
  
  console.log('[ScreenShare] Viewer cleanup complete');
}
```

### Emergency Cleanup (Stop Sharing Button)

```typescript
// Handle browser's "Stop sharing" button - IMMEDIATE action
function handleScreenShareEnded(): void {
  console.log('[ScreenShare] EMERGENCY: Screen share ended by browser');
  
  // 1. IMMEDIATELY notify server
  socket.emit('webrtc:screen_share_ended', {
    roomId,
    reason: 'user_stopped_sharing',
    timestamp: Date.now(),
  });
  
  // 2. Clean up resources immediately (don't wait for server)
  cleanupScreenShare('stop');
  
  // 3. Update UI immediately
  setIsSharing(false);
  setTransferState('idle');
  
  // 4. Show message to user
  showToast('Screen sharing ended. You can restart by clicking Start Screen Sharing.');
}

// Set up monitoring when screen share starts
function setupStopSharingDetection(screenTrack: MediaStreamTrack): void {
  console.log('[ScreenShare] Setting up stop sharing detection');
  
  // This fires when user clicks browser's "Stop sharing" button
  screenTrack.onended = () => {
    console.log('[ScreenShare] onended event fired - user stopped sharing');
    handleScreenShareEnded();
  };
  
  // Monitor for mute/unmute (some browsers use this)
  screenTrack.onmute = () => {
    console.log('[ScreenShare] Screen track muted');
  };
  
  screenTrack.onunmute = () => {
    console.log('[ScreenShare] Screen track unmuted');
  };
}
```

## 5. Structured Logging

```typescript
// Structured logging for debugging and monitoring
interface ScreenShareLog {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  roomId: string;
  userId: string;
  details?: Record<string, unknown>;
}

function logScreenShare(
  level: ScreenShareLog['level'],
  event: string,
  details?: Record<string, unknown>
): void {
  const log: ScreenShareLog = {
    timestamp: Date.now(),
    level,
    event,
    roomId,
    userId: currentUserId,
    details,
  };
  
  // Console output with structured format
  const prefix = `[ScreenShare][${level.toUpperCase()}]`;
  const message = `${prefix} ${event}`;
  
  switch (level) {
    case 'debug':
      console.debug(message, details);
      break;
    case 'info':
      console.info(message, details);
      break;
    case 'warn':
      console.warn(message, details);
      break;
    case 'error':
      console.error(message, details);
      // Could also send to error tracking service
      break;
  }
  
  // Store for debugging (keep last 100 logs)
  debugLogs.current.push(log);
  if (debugLogs.current.length > 100) {
    debugLogs.current.shift();
  }
}

// Usage examples
logScreenShare('info', 'Screen share started', {
  audioMode: 'system-and-mic',
  displaySurface: 'monitor',
  resolution: '1920x1080',
});

logScreenShare('error', 'Failed to acquire screen', {
  error: error.message,
  name: error.name,
});

logScreenShare('debug', 'ICE candidate received', {
  fromUserId,
  candidateType: candidate.type,
});
```

## 6. Media Toggle Controls

```typescript
// Pause/Resume screen sharing without stopping
type MediaControl = 'pause' | 'resume' | 'mute' | 'unmute';

async function controlMedia(action: MediaControl): Promise<void> {
  switch (action) {
    case 'pause':
      // Disable all tracks without stopping
      if (localStream.current) {
        localStream.current.getTracks().forEach(track => {
          track.enabled = false;
        });
        logScreenShare('info', 'Screen sharing paused');
      }
      break;
      
    case 'resume':
      // Re-enable all tracks
      if (localStream.current) {
        localStream.current.getTracks().forEach(track => {
          track.enabled = true;
        });
        logScreenShare('info', 'Screen sharing resumed');
      }
      break;
      
    case 'mute':
      // Mute only audio tracks
      audioTracks.current.forEach(track => {
        track.enabled = false;
      });
      setIsAudioMuted(true);
      socket.emit('webrtc:audio_mute_changed', { roomId, isMuted: true });
      logScreenShare('info', 'Audio muted');
      break;
      
    case 'unmute':
      // Unmute audio tracks
      audioTracks.current.forEach(track => {
        track.enabled = true;
      });
      setIsAudioMuted(false);
      socket.emit('webrtc:audio_mute_changed', { roomId, isMuted: false });
      logScreenShare('info', 'Audio unmuted');
      break;
  }
}

// Toggle function for UI
function toggleAudioMute(): void {
  if (isAudioMuted) {
    controlMedia('unmute');
  } else {
    controlMedia('mute');
  }
}
```
