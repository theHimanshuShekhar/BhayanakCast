> **Historical planning document.** This describes a manual RTCPeerConnection architecture that was never implemented. The actual implementation uses PeerJS — see [README.md](./README.md).

## 8. UI States During Screen Sharing

### Main Stream Container Component

```typescript
// src/components/ScreenShareContainer.tsx

interface ScreenShareContainerProps {
  roomId: string;
  isStreamer: boolean;
}

export function ScreenShareContainer({ roomId, isStreamer }: ScreenShareContainerProps) {
  const {
    localStream,
    remoteStream,
    isSharing,
    connectionState,
    transferInfo,
    audioMode,
    isAudioMuted,
    startScreenShare,
    stopScreenShare,
    toggleAudioMute,
  } = useScreenShare(roomId);
  
  const [showAudioConfig, setShowAudioConfig] = useState(false);
  
  // Load saved audio preference
  useEffect(() => {
    const savedMode = localStorage.getItem('screenShareAudioMode') as AudioMode | null;
    if (savedMode && !isSharing && isStreamer) {
      // Pre-select saved preference but don't auto-start
    }
  }, [isSharing, isStreamer]);
  
  return (
    <div className="screen-share-container">
      {/* Transfer overlay */}
      <TransferOverlay
        state={connectionState}
        info={transferInfo}
      />
      
      {/* Audio configuration modal */}
      <AudioConfigModal
        isOpen={showAudioConfig}
        previousMode={transferInfo?.previousAudioMode}
        onConfirm={(config) => {
          setShowAudioConfig(false);
          startScreenShare(config);
        }}
        onCancel={() => setShowAudioConfig(false)}
      />
      
      {/* Video display */}
      {isStreamer ? (
        <StreamerView
          stream={localStream}
          isSharing={isSharing}
          audioMode={audioMode}
          isAudioMuted={isAudioMuted}
          onStartShare={() => setShowAudioConfig(true)}
          onStopShare={stopScreenShare}
          onToggleMute={toggleAudioMute}
        />
      ) : (
        <ViewerView
          stream={remoteStream}
          connectionState={connectionState}
          audioEnabled={transferInfo?.audioMode !== 'silent'}
        />
      )}
    </div>
  );
}
```

### Streamer View with Controls

```typescript
// src/components/StreamerView.tsx

interface StreamerViewProps {
  stream: MediaStream | null;
  isSharing: boolean;
  audioMode: AudioMode;
  isAudioMuted: boolean;
  onStartShare: () => void;
  onStopShare: () => void;
  onToggleMute: () => void;
}

export function StreamerView({
  stream,
  isSharing,
  audioMode,
  isAudioMuted,
  onStartShare,
  onStopShare,
  onToggleMute,
}: StreamerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);
  
  if (!isSharing) {
    return (
      <div className="streamer-idle">
        <div className="start-share-prompt">
          <MonitorIcon size={48} />
          <h3>Start Screen Sharing</h3>
          <p>Share your screen with viewers</p>
          <button
            onClick={onStartShare}
            className="btn-primary btn-large"
          >
            <ShareIcon size={20} />
            Start Sharing
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="streamer-active">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="screen-preview"
      />
      
      {/* Screen share controls */}
      <div className="screen-controls">
        <button
          onClick={onStopShare}
          className="btn-danger"
          title="Stop sharing"
        >
          <StopIcon size={20} />
          Stop Sharing
        </button>
        
        {audioMode !== 'silent' && (
          <button
            onClick={onToggleMute}
            className={`btn-secondary ${isAudioMuted ? 'muted' : ''}`}
            title={isAudioMuted ? 'Unmute' : 'Mute'}
          >
            {isAudioMuted ? <MicOffIcon size={20} /> : <MicIcon size={20} />}
            {isAudioMuted ? 'Unmute' : 'Mute'}
          </button>
        )}
        
        <div className="audio-indicator">
          {audioMode === 'system-and-mic' && <Volume2Icon size={16} />}
          {audioMode === 'microphone-only' && <MicIcon size={16} />}
          {audioMode === 'silent' && <VolumeXIcon size={16} />}
          <span>
            {audioMode === 'system-and-mic' && 'System + Mic'}
            {audioMode === 'microphone-only' && 'Mic Only'}
            {audioMode === 'silent' && 'No Audio'}
          </span>
        </div>
      </div>
      
      {/* Screen sharing indicator */}
      <div className="sharing-indicator">
        <div className="recording-dot" />
        <span>Sharing Screen</span>
      </div>
    </div>
  );
}
```

### Viewer View

```typescript
// src/components/ViewerView.tsx

interface ViewerViewProps {
  stream: MediaStream | null;
  connectionState: TransferState;
  audioEnabled: boolean;
}

export function ViewerView({ stream, connectionState, audioEnabled }: ViewerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      setIsLoading(false);
    }
  }, [stream]);
  
  const showVideo = connectionState === 'connected' && stream;
  
  return (
    <div className="viewer-container">
      {showVideo ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="remote-screen"
          />
          
          {/* Audio indicator for viewer */}
          {audioEnabled && (
            <div className="viewer-audio-indicator">
              <Volume2Icon size={16} />
              <span>Audio On</span>
            </div>
          )}
        </>
      ) : (
        <div className="waiting-screen">
          <div className="waiting-content">
            <MonitorIcon size={64} opacity={0.5} />
            <p>Waiting for screen share...</p>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Transfer Overlay

```typescript
// src/components/TransferOverlay.tsx

interface TransferOverlayProps {
  state: TransferState;
  info: TransferInfo | null;
}

export function TransferOverlay({ state, info }: TransferOverlayProps) {
  const messages: Record<TransferState, { title: string; subtitle?: string }> = {
    idle: { title: '' },
    initiating: {
      title: 'Streamer ended screen share',
      subtitle: 'Transferring to new streamer...',
    },
    cleaning_up: {
      title: 'Disconnecting...',
      subtitle: 'Cleaning up previous connection',
    },
    waiting_for_streamer: {
      title: `Waiting for ${info?.newStreamerName || 'new streamer'}...`,
      subtitle: 'They need to start screen sharing',
    },
    reconnecting: {
      title: 'Connecting to new stream...',
      subtitle: 'Setting up peer-to-peer connection',
    },
    connected: { title: '' },
    failed: {
      title: 'Connection failed',
      subtitle: 'Retrying...',
    },
  };
  
  const showOverlay = state !== 'idle' && state !== 'connected';
  
  if (!showOverlay) return null;
  
  const { title, subtitle } = messages[state];
  
  return (
    <div className="transfer-overlay">
      <div className="transfer-content">
        <div className="transfer-spinner" />
        <h3 className="transfer-title">{title}</h3>
        {subtitle && (
          <p className="transfer-subtitle">{subtitle}</p>
        )}
        {state === 'waiting_for_streamer' && (
          <p className="transfer-hint">
            This may take a few moments...
          </p>
        )}
      </div>
    </div>
  );
}
```

### Audio Configuration Modal

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
  const [remember, setRemember] = useState(false);
  
  if (!isOpen) return null;
  
  const options: Array<{
    mode: AudioMode;
    icon: React.ReactNode;
    title: string;
    description: string;
  }> = [
    {
      mode: 'system-and-mic',
      icon: <Volume2Icon size={24} />,
      title: 'Share screen with audio',
      description: 'System audio + microphone',
    },
    {
      mode: 'microphone-only',
      icon: <MicIcon size={24} />,
      title: 'Share screen with microphone only',
      description: 'Voice only, no system sounds',
    },
    {
      mode: 'silent',
      icon: <VolumeXIcon size={24} />,
      title: 'Share screen without audio',
      description: 'Silent screen share',
    },
  ];
  
  return (
    <div className="modal-overlay">
      <div className="audio-config-modal">
        <div className="modal-header">
          <MonitorIcon size={32} />
          <h2>Start Screen Sharing</h2>
          <p>Choose what to share with viewers</p>
        </div>
        
        <div className="audio-options">
          {options.map((option) => (
            <button
              key={option.mode}
              className={`audio-option ${selectedMode === option.mode ? 'selected' : ''}`}
              onClick={() => setSelectedMode(option.mode)}
            >
              <div className="option-icon">{option.icon}</div>
              <div className="option-content">
                <span className="option-title">{option.title}</span>
                <span className="option-description">{option.description}</span>
              </div>
              {selectedMode === option.mode && (
                <CheckIcon size={20} className="check-icon" />
              )}
            </button>
          ))}
        </div>
        
        <label className="remember-option">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Remember my choice for future streams</span>
        </label>
        
        <div className="modal-actions">
          <button onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ mode: selectedMode, rememberPreference: remember })}
            className="btn-primary"
          >
            Start Sharing
          </button>
        </div>
      </div>
    </div>
  );
}
```

## 9. Error Handling

### Screen Share Error Recovery

```typescript
// src/hooks/useScreenShare.ts - error handling

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_BASE = 3000; // Increased for screen sharing

function handleConnectionFailure(): void {
  const attempts = reconnectAttempts.current;
  
  if (attempts < MAX_RECONNECT_ATTEMPTS) {
    console.log(`[ScreenShare] Retrying connection (attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
    logScreenShare('warn', 'Connection failed, retrying', { attempt: attempts + 1 });
    
    reconnectAttempts.current = attempts + 1;
    setTransferState('failed');
    
    // Exponential backoff
    const delay = RECONNECT_DELAY_BASE * Math.pow(2, attempts);
    
    setTimeout(() => {
      if (streamerId.current) {
        reconnectToStreamer(streamerId.current);
      }
    }, delay);
    
  } else {
    console.error('[ScreenShare] Max reconnection attempts reached');
    logScreenShare('error', 'Max reconnection attempts reached');
    
    setTransferState('failed');
    setLastError('Unable to connect. The streamer may need to restart sharing.');
    
    // Notify server
    socket.emit('webrtc:connection_failed', {
      roomId,
      targetUserId: streamerId.current,
      reason: 'max_retries_exceeded',
    });
  }
}

// Handle ICE connection failures with restart
function setupPeerConnectionHandlers(
  pc: RTCPeerConnection,
  userId: string,
  isStreamer: boolean
): void {
  pc.oniceconnectionstatechange = () => {
    console.log(`[ScreenShare] ICE state with ${userId}: ${pc.iceConnectionState}`);
    logScreenShare('debug', 'ICE state change', {
      peerId: userId,
      state: pc.iceConnectionState,
    });
    
    if (pc.iceConnectionState === 'failed') {
      console.error(`[ScreenShare] ICE failed with ${userId}`);
      logScreenShare('warn', 'ICE connection failed', { peerId: userId });
      
      // Either side can restart ICE
      restartIceConnection(pc, isStreamer).catch(() => {
        if (!isStreamer) {
          handleConnectionFailure();
        }
      });
    }
  };
  
  pc.onconnectionstatechange = () => {
    console.log(`[ScreenShare] Connection state with ${userId}: ${pc.connectionState}`);
    
    if (pc.connectionState === 'failed') {
      logScreenShare('error', 'Peer connection failed', { peerId: userId });
      if (!isStreamer) {
        handleConnectionFailure();
      }
    }
  };
}

// Handle screen share permission errors
async function handleScreenShareError(error: unknown): Promise<void> {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        setLastError('Screen sharing was cancelled. Please select a screen to share.');
        showPermissionHelp();
        break;
        
      case 'NotFoundError':
        setLastError('No display found to share. Please ensure you have a monitor connected.');
        break;
        
      case 'NotReadableError':
        setLastError('Could not access your screen. It may be in use by another application.');
        break;
        
      case 'AbortError':
        // User cancelled - no error needed
        console.log('[ScreenShare] User cancelled screen share');
        break;
        
      default:
        setLastError(`Screen share error: ${error.message}`);
    }
  } else {
    setLastError('An unexpected error occurred. Please try again.');
  }
  
  logScreenShare('error', 'Screen share error', {
    error: (error as Error).message,
    name: (error as Error).name,
  });
}
```

### Permission Help UI

```typescript
// src/components/PermissionHelp.tsx

export function PermissionHelp() {
  return (
    <div className="permission-help">
      <h4>How to enable screen sharing:</h4>
      <ol>
        <li>Click the "Start Sharing" button</li>
        <li>When prompted, select the screen/window to share</li>
        <li>Click "Share" in the browser dialog</li>
      </ol>
      
      <div className="browser-specific">
        <h5>Chrome/Edge:</h5>
        <p>Look for the popup in the center of your screen</p>
        
        <h5>Firefox:</h5>
        <p>A permissions bar will appear at the top</p>
      </div>
    </div>
  );
}
```

### CSS Styling for Screen Sharing

```css
/* src/styles/screen-share.css */

.screen-share-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--depth-1);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

/* Transfer overlay */
.transfer-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  backdrop-filter: blur(4px);
}

.transfer-content {
  text-align: center;
  color: white;
  padding: 2rem;
}

.transfer-spinner {
  width: 48px;
  height: 48px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

.transfer-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.transfer-subtitle {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.875rem;
}

.transfer-hint {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
  margin-top: 1rem;
}

/* Streamer idle state */
.streamer-idle {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 2rem;
}

.start-share-prompt {
  text-align: center;
  color: var(--text-muted);
}

.start-share-prompt h3 {
  color: var(--text);
  margin: 1rem 0 0.5rem;
}

/* Streamer controls */
.screen-controls {
  position: absolute;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.8);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(8px);
}

.sharing-indicator {
  position: absolute;
  top: 1rem;
  left: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(220, 38, 38, 0.9);
  color: white;
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  font-weight: 500;
}

.recording-dot {
  width: 8px;
  height: 8px;
  background: white;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

/* Audio config modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.audio-config-modal {
  background: var(--depth-1);
  border-radius: var(--radius-xl);
  padding: 2rem;
  max-width: 480px;
  width: 90%;
}

.modal-header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.audio-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.audio-option {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--depth-2);
  border: 2px solid transparent;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s;
}

.audio-option:hover {
  background: var(--depth-3);
}

.audio-option.selected {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.1);
}

.option-icon {
  color: var(--text-muted);
}

.option-content {
  flex: 1;
  text-align: left;
}

.option-title {
  display: block;
  font-weight: 500;
  color: var(--text);
}

.option-description {
  display: block;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.check-icon {
  color: var(--accent);
}

/* Animations */
@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```
