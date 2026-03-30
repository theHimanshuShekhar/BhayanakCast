> **Historical planning document.** This describes a manual RTCPeerConnection architecture that was never implemented. The actual implementation uses PeerJS — see [README.md](./README.md).

## 5. New Streamer Screen Sharing Sequence

```typescript
// src/hooks/useScreenShare.ts - startScreenShare()

async function startScreenShare(config: AudioConfig): Promise<void> {
  console.log('[ScreenShare] Starting screen share with audio mode:', config.mode);
  logScreenShare('info', 'Screen share initiation started', { audioMode: config.mode });
  
  try {
    // 1. Get screen stream
    console.log('[ScreenShare] Requesting display media...');
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { max: 1920 },
        height: { max: 1080 },
        frameRate: { max: 30, ideal: 15 },
        cursor: 'always',
        displaySurface: 'monitor', // User can change in browser picker
        logicalSurface: true,
      },
      audio: config.mode === 'system-and-mic' ? {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 48000,
        sampleSize: 16,
        channelCount: 2,
      } : false,
    });
    
    const screenTrack = screenStream.getVideoTracks()[0];
    const systemAudioTracks = screenStream.getAudioTracks();
    
    logScreenShare('info', 'Display media acquired', {
      displaySurface: screenTrack.getSettings().displaySurface,
      resolution: `${screenTrack.getSettings().width}x${screenTrack.getSettings().height}`,
      hasSystemAudio: systemAudioTracks.length > 0,
    });
    
    // 2. Get additional audio if needed
    const additionalAudioTracks: MediaStreamTrack[] = [];
    
    if (config.mode === 'system-and-mic' || config.mode === 'microphone-only') {
      console.log('[ScreenShare] Requesting microphone...');
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
          },
        });
        additionalAudioTracks.push(...micStream.getAudioTracks());
        logScreenShare('info', 'Microphone acquired');
      } catch (error) {
        console.warn('[ScreenShare] Could not get microphone:', error);
        logScreenShare('warn', 'Microphone acquisition failed', { error: (error as Error).message });
        // Continue without mic - screen share is primary
      }
    }
    
    // 3. Combine all tracks into one stream
    const combinedStream = new MediaStream([
      screenTrack,
      ...systemAudioTracks,
      ...additionalAudioTracks,
    ]);
    
    localStream.current = combinedStream;
    screenTrackRef.current = screenTrack;
    audioTracks.current = [...systemAudioTracks, ...additionalAudioTracks];
    
    // 4. Set up CRITICAL stop sharing detection
    setupStopSharingDetection(screenTrack);
    
    // 5. Display local preview
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = combinedStream;
      localVideoRef.current.muted = true; // Don't hear own audio
    }
    
    // 6. Create peer connections for each viewer
    for (const viewer of viewers.current) {
      await createPeerConnectionForViewer(viewer);
    }
    
    // 7. Update state
    setIsSharing(true);
    setIsStreamer(true);
    setAudioMode(config.mode);
    
    // 8. Save preference if requested
    if (config.rememberPreference) {
      localStorage.setItem('screenShareAudioMode', config.mode);
    }
    
    // 9. Notify server
    socket.emit('webrtc:streamer_ready', {
      roomId,
      audioMode: config.mode,
    });
    
    logScreenShare('info', 'Screen share started successfully');
    
  } catch (error) {
    console.error('[ScreenShare] Failed to start screen share:', error);
    logScreenShare('error', 'Screen share initiation failed', {
      error: (error as Error).message,
      name: (error as Error).name,
    });
    
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') {
        setLastError('Screen sharing permission denied. Please allow access when prompted.');
      } else if (error.name === 'NotFoundError') {
        setLastError('No screen to share. Please select a screen/window.');
      } else {
        setLastError(`Screen share error: ${error.message}`);
      }
    } else {
      setLastError('Failed to start screen sharing. Please try again.');
    }
    
    throw error;
  }
}

// Set up monitoring for browser's "Stop sharing" button
function setupStopSharingDetection(screenTrack: MediaStreamTrack): void {
  console.log('[ScreenShare] Setting up stop sharing detection');
  
  screenTrack.onended = () => {
    console.log('[ScreenShare] CRITICAL: Screen track ended (Stop sharing button clicked)');
    logScreenShare('info', 'Screen sharing stopped by user via browser UI');
    
    // IMMEDIATE notification to server
    socket.emit('webrtc:screen_share_ended', {
      roomId,
      reason: 'user_stopped_sharing',
      timestamp: Date.now(),
    });
    
    // Immediate cleanup
    handleScreenShareEnded();
  };
  
  screenTrack.onmute = () => {
    console.log('[ScreenShare] Screen track muted');
    logScreenShare('debug', 'Screen track muted');
  };
  
  screenTrack.onunmute = () => {
    console.log('[ScreenShare] Screen track unmuted');
    logScreenShare('debug', 'Screen track unmuted');
  };
}
```

## 6. Peer Connection Creation with Simulcast

```typescript
async function createPeerConnectionForViewer(
  viewer: { userId: string; userName: string }
): Promise<void> {
  console.log(`[ScreenShare] Creating peer connection for viewer ${viewer.userId}`);
  
  const pc = new RTCPeerConnection({
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
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  });
  
  // Add local tracks with simulcast for adaptive quality
  if (localStream.current) {
    for (const track of localStream.current.getTracks()) {
      const sender = pc.addTrack(track, localStream.current);
      
      // Enable simulcast for video tracks (adaptive quality)
      if (track.kind === 'video') {
        await setupSimulcast(sender);
      }
    }
  }
  
  // Create data channel for this viewer
  const dataChannel = pc.createDataChannel('chat', {
    ordered: true,
  });
  
  // Store connection state
  const peerState: PeerConnectionState = {
    connection: pc,
    userId: viewer.userId,
    userName: viewer.userName,
    connectionState: 'new',
    iceConnectionState: 'new',
    signalingState: 'stable',
    dataChannel,
    restartAttempts: 0,
  };
  
  peerConnections.current.set(viewer.userId, peerState);
  
  // Set up event handlers
  setupPeerConnectionHandlers(pc, viewer.userId, true);
}

// Enable simulcast for adaptive bitrate
async function setupSimulcast(sender: RTCRtpSender): Promise<void> {
  const params = sender.getParameters();
  
  // Add simulcast encodings for adaptive quality
  // Screen sharing needs high bitrate for text clarity
  params.encodings = [
    {
      rid: 'high',
      maxBitrate: 2500000,     // 2.5 Mbps - full quality
      maxFramerate: 30,
    },
    {
      rid: 'medium',
      maxBitrate: 1000000,     // 1 Mbps
      scaleResolutionDownBy: 2,
      maxFramerate: 15,
    },
    {
      rid: 'low',
      maxBitrate: 500000,      // 500 Kbps
      scaleResolutionDownBy: 4,
      maxFramerate: 10,
    },
  ];
  
  await sender.setParameters(params);
  console.log('[ScreenShare] Simulcast enabled for adaptive quality');
  logScreenShare('debug', 'Simulcast configured');
}
```

## 7. Viewer Reconnection Flow

```typescript
// src/hooks/useScreenShare.ts - reconnectToStreamer()

async function reconnectToStreamer(streamerId: string): Promise<void> {
  console.log(`[ScreenShare] Reconnecting to new streamer ${streamerId}...`);
  logScreenShare('info', 'Starting reconnection to new streamer', { streamerId });
  
  try {
    // 1. Update state
    setTransferState('reconnecting');
    setStreamerId(streamerId);
    
    // 2. Create new peer connection
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
    });
    
    // 3. Set up to receive remote stream
    const remoteStream = new MediaStream();
    
    pc.ontrack = (event) => {
      console.log(`[ScreenShare] Received remote track: ${event.track.kind}`);
      logScreenShare('debug', 'Remote track received', {
        kind: event.track.kind,
        label: event.track.label,
      });
      
      remoteStream.addTrack(event.track);
      
      // Update video element once we have video track
      if (remoteVideoRef.current && event.track.kind === 'video') {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    };
    
    // 4. Create and send offer with ICE restart support
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    
    await pc.setLocalDescription(offer);
    
    // 5. Store connection
    streamerConnection.current = {
      connection: pc,
      userId: streamerId,
      connectionState: 'connecting',
      remoteStream,
      restartAttempts: 0,
    };
    
    // 6. Send offer to server (which forwards to streamer)
    socket.emit('webrtc:offer', {
      roomId,
      toUserId: streamerId,
      offer,
    });
    
    // 7. Set up connection state monitoring
    pc.onconnectionstatechange = () => {
      console.log(`[ScreenShare] Connection state: ${pc.connectionState}`);
      logScreenShare('debug', 'Connection state changed', { state: pc.connectionState });
      
      if (pc.connectionState === 'connected') {
        setTransferState('connected');
        setConnectionStatus('connected');
        setReconnectAttempts(0);
        
        // Report success to server
        socket.emit('webrtc:connection_established', {
          roomId,
          streamerId,
          timestamp: Date.now(),
        });
        
        logScreenShare('info', 'Connection established');
      } else if (pc.connectionState === 'failed') {
        setConnectionStatus('failed');
        handleConnectionFailure();
      }
    };
    
    // 8. Handle ICE connection state (for ICE restart)
    pc.oniceconnectionstatechange = () => {
      console.log(`[ScreenShare] ICE state: ${pc.iceConnectionState}`);
      logScreenShare('debug', 'ICE state changed', { state: pc.iceConnectionState });
      
      if (pc.iceConnectionState === 'failed') {
        // Both sides can initiate ICE restart
        restartIceConnection(pc, false);
      }
    };
    
    // 9. Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc:ice-candidate', {
          roomId,
          toUserId: streamerId,
          candidate: event.candidate,
        });
      }
    };
    
    console.log('[ScreenShare] Reconnection offer sent');
    
  } catch (error) {
    console.error('[ScreenShare] Reconnection failed:', error);
    logScreenShare('error', 'Reconnection failed', { error: (error as Error).message });
    setLastError('Failed to reconnect');
    handleConnectionFailure();
  }
}
```

## 8. ICE Restart (Both Sides)

```typescript
// ICE restart can be initiated by either streamer or viewer
async function restartIceConnection(
  pc: RTCPeerConnection,
  isStreamer: boolean
): Promise<void> {
  const peerId = isStreamer 
    ? 'viewer' 
    : streamerConnection.current?.userId;
  
  console.log(`[ScreenShare] Initiating ICE restart (${isStreamer ? 'streamer' : 'viewer'})`);
  logScreenShare('info', 'ICE restart initiated', { isStreamer, peerId });
  
  try {
    // Create new offer with ICE restart flag
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    
    // Send to peer
    if (isStreamer) {
      // Streamer sends to all viewers - need to identify which one
      // This is handled in the peer connection loop
    } else {
      // Viewer sends to streamer
      socket.emit('webrtc:ice_restart_offer', {
        roomId,
        offer,
      });
    }
    
    logScreenShare('debug', 'ICE restart offer sent');
    
  } catch (error) {
    console.error('[ScreenShare] ICE restart failed:', error);
    logScreenShare('error', 'ICE restart failed', { error: (error as Error).message });
    throw error;
  }
}

// Handle incoming ICE restart offer
socket.on('webrtc:ice_restart_offer', async ({ fromUserId, offer }) => {
  console.log(`[ScreenShare] Received ICE restart offer from ${fromUserId}`);
  logScreenShare('debug', 'ICE restart offer received', { fromUserId });
  
  const pc = isStreamer
    ? peerConnections.current.get(fromUserId)?.connection
    : streamerConnection.current?.connection;
  
  if (!pc) {
    console.warn('[ScreenShare] No peer connection found for ICE restart');
    return;
  }
  
  try {
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('webrtc:answer', {
      roomId,
      toUserId: fromUserId,
      answer,
      isIceRestart: true,
    });
    
    logScreenShare('debug', 'ICE restart answer sent');
    
  } catch (error) {
    console.error('[ScreenShare] Failed to handle ICE restart:', error);
    logScreenShare('error', 'ICE restart handling failed', { error: (error as Error).message });
  }
});
```

## 9. Viewer Queue During Transfer

```typescript
// Manage viewer queue when new streamer is preparing
interface ViewerQueueState {
  position: number;
  totalViewers: number;
  status: 'waiting' | 'connecting' | 'connected';
  estimatedWaitSeconds: number;
}

// When transfer initiates, server assigns queue positions
socket.on('webrtc:transfer_initiating', (data) => {
  // Calculate position based on join order
  const position = data.allParticipants.findIndex(
    p => p.userId === currentUserId
  );
  
  // Show queue status
  setViewerQueue({
    position,
    totalViewers: data.allParticipants.length,
    status: 'waiting',
    estimatedWaitSeconds: 10 + (position * 2), // ~2 seconds per viewer
  });
});

// Server staggers reconnections to avoid overwhelming new streamer
socket.on('webrtc:reconnect_now', () => {
  setViewerQueue(prev => ({
    ...prev,
    status: 'connecting',
  }));
  
  // Proceed with reconnection
  reconnectToStreamer(newStreamerId);
});

// Connection established
socket.on('webrtc:connection_established', () => {
  setViewerQueue(prev => ({
    ...prev,
    status: 'connected',
  }));
});
```

## 10. Audio Configuration Component

```typescript
// src/components/AudioConfigModal.tsx

interface AudioConfigModalProps {
  isOpen: boolean;
  previousMode?: AudioMode;
  onConfirm: (config: AudioConfig) => void;
  onCancel: () => void;
}

export function AudioConfigModal({
  isOpen,
  previousMode,
  onConfirm,
  onCancel,
}: AudioConfigModalProps) {
  const [selectedMode, setSelectedMode] = useState<AudioMode>(
    previousMode || 'system-and-mic'
  );
  const [rememberPreference, setRememberPreference] = useState(false);
  
  if (!isOpen) return null;
  
  const options: { mode: AudioMode; label: string; description: string }[] = [
    {
      mode: 'system-and-mic',
      label: 'Share screen with audio',
      description: 'Share your screen with both system audio and microphone',
    },
    {
      mode: 'microphone-only',
      label: 'Share screen with microphone only',
      description: 'Share your screen with voice only (no system sounds)',
    },
    {
      mode: 'silent',
      label: 'Share screen without audio',
      description: 'Share your screen silently (no audio)',
    },
  ];
  
  return (
    <div className="audio-config-modal">
      <h2>Start Screen Sharing</h2>
      <p>Choose your audio settings:</p>
      
      <div className="audio-options">
        {options.map((option) => (
          <label
            key={option.mode}
            className={`audio-option ${selectedMode === option.mode ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="audioMode"
              value={option.mode}
              checked={selectedMode === option.mode}
              onChange={() => setSelectedMode(option.mode)}
            />
            <div className="option-content">
              <span className="option-label">{option.label}</span>
              <span className="option-description">{option.description}</span>
            </div>
          </label>
        ))}
      </div>
      
      <label className="remember-preference">
        <input
          type="checkbox"
          checked={rememberPreference}
          onChange={(e) => setRememberPreference(e.target.checked)}
        />
        Remember my preference for future streams
      </label>
      
      <div className="modal-actions">
        <button onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
        <button
          onClick={() => onConfirm({ mode: selectedMode, rememberPreference })}
          className="btn-primary"
        >
          Start Sharing
        </button>
      </div>
    </div>
  );
}
```
