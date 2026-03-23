# WebRTC Screen Sharing - Overview and Sequence

## Overview

This document details the production-ready implementation for screen sharing with WebRTC in BhayanakCast, with graceful handling during streamer transfers.

## Key Differences from Camera-Based Streaming

| Aspect | Camera | Screen Sharing |
|--------|--------|----------------|
| **Media API** | `getUserMedia()` | `getDisplayMedia()` |
| **Audio** | Microphone only | System audio + mic (optional) |
| **Stop Detection** | Manual stop | Browser UI + manual stop |
| **Resolution** | Fixed | Variable (user's screen) |
| **Frame Rate** | 30fps | 15-30fps acceptable |
| **Timing** | 3-5s setup | 8-15s setup acceptable |

## Architecture Context

**Current State:**
- Socket.io-based room management with automatic streamer transfer
- P2P mesh: Streamer has N peer connections (one per viewer)
- Each viewer maintains one RTCPeerConnection to the streamer
- Screen sharing via `getDisplayMedia()` API

**Challenge:** When streamer leaves:
1. Detect browser's "Stop sharing" button (critical)
2. Gracefully close all peer connections
3. Transfer screen sharing to new streamer
4. Handle 8-15 second reconnection window
5. Support audio configuration during transfer

## 1. Exact Sequence of Events During Screen Share Transfer

### Phase 1: Streamer Departure Detection

```
T+0ms: Old streamer:
       - Clicks "Stop sharing" button in browser UI, OR
       - Clicks "Leave Room" / closes tab
       ↓
T+50ms: Browser triggers track.onended for screen track
        - We catch this and immediately emit webrtc:screen_share_ended
       ↓
T+100ms: Server detects disconnect via:
         - socket.on('disconnect') event, OR
         - Explicit webrtc:screen_share_ended emission
        ↓
T+200ms: Server executes removeParticipant()
         - Calculates watch time
         - Finds earliest viewer as new streamer
         - Updates database
```

**Critical:** Screen share `onended` event fires immediately when user clicks browser's "Stop sharing" button. This must trigger instant cleanup.

### Phase 2: WebRTC Teardown Initiation

```
T+300ms: Server emits webrtc:transfer_initiating to ALL room members
         Payload: {
           oldStreamerId: string;
           newStreamerId: string;
           reason: 'streamer_left' | 'screen_share_ended' | 'manual_transfer';
           estimatedReconnectAt: number; // timestamp + 8000ms
           wasScreenSharing: true; // Always true for our implementation
           audioMode?: AudioMode; // Previous streamer's audio config
         }
       ↓
T+400ms: Old streamer (if still connected) receives event
         - Initiates graceful connection close
         - Stops all media tracks
         - Closes all peer connections
       ↓
T+500ms: All viewers receive event
         - Show "Streamer ended screen share - Reconnecting..." UI
         - Begin connection teardown
```

### Phase 3: Connection Cleanup

```
T+600ms: All clients execute cleanupConnection()
         - Send 'stream-ended' via data channel (if open)
         - Stop all remote tracks
         - Close peer connections
         - Clear video elements
       ↓
T+1000ms: Connections closed, ICE agents terminated
```

### Phase 4: New Streamer Preparation (Explicit Opt-in)

```
T+1500ms: New streamer receives webrtc:become_streamer event
          Payload: {
            viewers: Array<{ userId, userName }>;
            previousAudioMode?: AudioMode;
            showStartButton: true; // Must click to start
          }
        ↓
T+2000ms: New streamer UI shows:
          - "You are now the streamer" notification
          - "Start Screen Sharing" button (prominent)
          - Audio configuration options (pre-selected from previous)
        ↓
T+[2000-10000ms]: New streamer clicks "Start Screen Sharing"
          - Shows audio configuration modal
          - User selects: system-and-mic | microphone-only | silent
          - Calls getDisplayMedia() with audio constraints
          - May take 2-8 seconds for user to complete
        ↓
T+1200ms after click: Screen share acquired
          - Display local preview
          - Create peer connections for each viewer
          - Set up track monitoring (onended listener)
```

**Key Point:** Timing is variable here (2-10 seconds) because user must explicitly opt-in and configure audio.

### Phase 5: Reconnection

```
T+8000ms: Server emits webrtc:reconnect_now to all viewers
          Payload: {
            newStreamerId: string;
            newStreamerName: string;
            audioEnabled: boolean; // For UI indicator
          }
        ↓
T+8200ms: Viewers create fresh peer connections
          - Create RTCPeerConnection with new streamer
          - Create and send offer
          - Adaptive quality enabled (simulcast)
        ↓
T+9000ms: New streamer receives offers, sends answers
          - Add viewers to peerConnections map
          - ICE negotiation begins
        ↓
T+10000-15000ms: ICE complete, media flowing
        ↓
T+15000ms: Connection established, show video
```

**Acceptable Range:** 8-15 seconds total is acceptable for screen sharing setup.

## 2. Audio Configuration System

### Audio Modes

```typescript
type AudioMode = 
  | 'system-and-mic'    // DisplayMedia with audio: true + getUserMedia for mic
  | 'microphone-only'   // DisplayMedia with audio: false + getUserMedia for mic
  | 'silent';           // No audio tracks at all

interface AudioConfig {
  mode: AudioMode;
  rememberPreference: boolean;
}
```

### Audio Track Acquisition

```typescript
async function acquireAudioTracks(config: AudioConfig): Promise<MediaStreamTrack[]> {
  const tracks: MediaStreamTrack[] = [];
  
  switch (config.mode) {
    case 'system-and-mic':
      // System audio comes with screen share
      // Microphone needs separate getUserMedia
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tracks.push(...micStream.getAudioTracks());
      break;
      
    case 'microphone-only':
      // Only microphone, no system audio
      const voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tracks.push(...voiceStream.getAudioTracks());
      break;
      
    case 'silent':
      // No audio tracks
      break;
  }
  
  return tracks;
}
```

## 3. Stop Sharing Detection (Critical)

### Browser Stop Button Handling

```typescript
function setupScreenTrackMonitoring(
  screenTrack: MediaStreamTrack,
  onSharingEnded: () => void
): void {
  console.log('[WebRTC] Setting up screen track monitoring');
  
  // This fires when user clicks "Stop sharing" in browser UI
  screenTrack.onended = () => {
    console.log('[WebRTC] Screen track ended (user clicked Stop sharing)');
    
    // IMMEDIATELY notify server - no delay
    socket.emit('webrtc:screen_share_ended', {
      roomId,
      reason: 'user_stopped_sharing',
      timestamp: Date.now(),
    });
    
    // Trigger immediate cleanup
    onSharingEnded();
  };
  
  // Also monitor track state
  screenTrack.onmute = () => {
    console.log('[WebRTC] Screen track muted');
  };
  
  screenTrack.onunmute = () => {
    console.log('[WebRTC] Screen track unmuted');
  };
}
```

### Why This Is Critical

Users can stop sharing at ANY time via the browser's native UI. We must:
1. Detect it immediately via `onended`
2. Notify server instantly
3. Trigger transfer or room cleanup
4. Show appropriate UI ("Screen sharing ended")

## 4. Connection State Management

### Data Structures

```typescript
// src/hooks/useScreenShare.ts

interface PeerConnectionState {
  connection: RTCPeerConnection;
  userId: string;
  userName: string;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  signalingState: RTCSignalingState;
  dataChannel?: RTCDataChannel;
  remoteStream?: MediaStream;
  restartAttempts: number; // Track ICE restart attempts
}

interface ScreenShareState {
  // Local state
  localStream: MediaStream | null;
  screenTrack: MediaStreamTrack | null;
  audioTracks: MediaStreamTrack[];
  isStreamer: boolean;
  streamerId: string | null;
  audioMode: AudioMode;
  
  // Connection management
  peerConnections: Map<string, PeerConnectionState>;
  
  // Transfer state
  transferState: 
    | 'idle' 
    | 'initiating' 
    | 'cleaning_up' 
    | 'waiting_for_streamer' 
    | 'reconnecting' 
    | 'connected';
  transferInfo: {
    oldStreamerId?: string;
    newStreamerId?: string;
    reason?: string;
    showStartButton?: boolean;
  } | null;
  
  // UI state
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'failed';
  reconnectAttempts: number;
  lastError?: string;
  isAudioMuted: boolean;
  
  // Screen share specific
  isSharing: boolean;
  displaySurface?: 'monitor' | 'window' | 'browser';
}

interface UseScreenShareReturn {
  // State
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  isStreamer: boolean;
  isSharing: boolean;
  connectionState: ScreenShareState['transferState'];
  connectionStatus: ScreenShareState['connectionStatus'];
  audioMode: AudioMode;
  isAudioMuted: boolean;
  
  // Actions
  startScreenShare: (config: AudioConfig) => Promise<void>;
  stopScreenShare: () => void;
  connectToStreamer: (streamerId: string) => Promise<void>;
  disconnect: () => void;
  toggleAudioMute: () => void;
  
  // Transfer handling
  initiateTransferCleanup: (info: TransferInfo) => Promise<void>;
  becomeStreamer: (viewers: ViewerInfo[], previousAudioMode?: AudioMode) => Promise<void>;
  reconnectToNewStreamer: (streamerId: string) => Promise<void>;
}
```

### State Machine

```typescript
// State transitions during transfer
const transferStateMachine = {
  idle: {
    STREAMER_LEFT: 'initiating',
    SCREEN_SHARE_ENDED: 'initiating',
    MANUAL_TRANSFER: 'initiating',
  },
  initiating: {
    CLEANUP_COMPLETE: 'cleaning_up',
  },
  cleaning_up: {
    BECOME_STREAMER: 'waiting_for_streamer',
    WAIT_FOR_STREAMER: 'waiting_for_streamer',
  },
  waiting_for_streamer: {
    // Explicit opt-in required
    USER_STARTED_SHARING: 'reconnecting',
    STREAMER_READY: 'reconnecting',
  },
  reconnecting: {
    CONNECTION_ESTABLISHED: 'connected',
    CONNECTION_FAILED: 'failed',
    SCREEN_SHARE_ENDED: 'initiating', // Can happen during transfer
  },
  connected: {
    STREAMER_LEFT: 'initiating',
    SCREEN_SHARE_ENDED: 'initiating',
  },
  failed: {
    RETRY: 'reconnecting',
  },
};
```

## 5. Screen Sharing Constraints

### Display Media Options

```typescript
const screenShareConstraints = {
  video: {
    // Use user's native resolution
    width: { max: 1920 },
    height: { max: 1080 },
    // 15-30fps is acceptable for screen sharing
    frameRate: { max: 30, ideal: 15 },
    // Show cursor always
    cursor: 'always',
    // Allow all display surfaces
    displaySurface: 'monitor', // 'monitor', 'window', 'browser'
    // Logical surface for better quality
    logicalSurface: true,
  },
  audio: {
    // System audio (optional, user configurable)
    echoCancellation: false,
    noiseSuppression: false,
    sampleRate: 48000,
    sampleSize: 16,
    channelCount: 2,
  },
};

// Adaptive bitrate configuration
const rtcConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN servers for NAT traversal
    {
      urls: 'turn:turn.example.com:3478',
      username: 'user',
      credential: 'pass',
    },
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
  // Enable simulcast for adaptive quality
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};
```

### Simulcast Configuration (Auto Quality)

```typescript
async function setupSimulcast(sender: RTCRtpSender): Promise<void> {
  const params = sender.getParameters();
  
  // Add simulcast encodings for adaptive quality
  params.encodings = [
    { rid: 'high', maxBitrate: 2500000 },   // ~2.5 Mbps - best quality
    { rid: 'medium', maxBitrate: 1000000, scaleResolutionDownBy: 2 }, // ~1 Mbps
    { rid: 'low', maxBitrate: 500000, scaleResolutionDownBy: 4 },     // ~500 Kbps
  ];
  
  await sender.setParameters(params);
  console.log('[WebRTC] Simulcast enabled for adaptive quality');
}
```

## 6. Transfer Completion Tracking

```typescript
// Track which viewers have successfully reconnected
interface TransferCompletionState {
  transferId: string;
  startedAt: number;
  expectedViewers: Set<string>;
  reconnectedViewers: Set<string>;
  failedViewers: Set<string>;
  completed: boolean;
}

// Server tracks completion
const transferCompletions = new Map<string, TransferCompletionState>();

function trackViewerReconnected(roomId: string, viewerId: string): void {
  const state = transferCompletions.get(roomId);
  if (!state) return;
  
  state.reconnectedViewers.add(viewerId);
  
  // Check if all expected viewers reconnected
  const allReconnected = [...state.expectedViewers].every(
    id => state.reconnectedViewers.has(id)
  );
  
  if (allReconnected && !state.completed) {
    state.completed = true;
    const duration = Date.now() - state.startedAt;
    console.log(`[WebRTC] Transfer completed in ${duration}ms`);
    
    // Notify streamer
    io.to(roomId).emit('webrtc:transfer_complete', {
      duration,
      viewerCount: state.reconnectedViewers.size,
    });
    
    // Cleanup
    transferCompletions.delete(roomId);
  }
}
```

## 7. ICE Restart (Both Sides)

```typescript
// Either streamer or viewer can initiate ICE restart
async function restartIceConnection(
  pc: RTCPeerConnection,
  isStreamer: boolean
): Promise<void> {
  console.log(`[WebRTC] Initiating ICE restart (${isStreamer ? 'streamer' : 'viewer'})`);
  
  try {
    // Create new offer with ICE restart flag
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    
    // Notify peer
    const event = isStreamer ? 'webrtc:offer' : 'webrtc:ice_restart_offer';
    socket.emit(event, {
      roomId,
      offer,
      isIceRestart: true,
    });
    
  } catch (error) {
    console.error('[WebRTC] ICE restart failed:', error);
    throw error;
  }
}

// Handle incoming ICE restart
socket.on('webrtc:ice_restart_offer', async ({ fromUserId, offer }) => {
  const pc = peerConnections.current.get(fromUserId)?.connection;
  if (!pc) return;
  
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  
  socket.emit('webrtc:answer', {
    roomId,
    toUserId: fromUserId,
    answer,
    isIceRestart: true,
  });
});
```
