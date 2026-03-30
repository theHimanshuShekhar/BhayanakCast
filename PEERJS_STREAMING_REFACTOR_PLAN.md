# PeerJS Streaming Refactor Plan

**Status:** Sprint 1 Complete  
**Goal:** Fix critical bugs and add robustness to PeerJS streaming  
**Approach:** PeerJS with room state peer ID tracking, infinite retry, comprehensive tests

## Sprint 1 Progress
- [x] **Task 1:** Fix streamer ready race condition (COMPLETED)
- [x] **Task 2:** Add streamerPeerId to RoomState types (COMPLETED)
- [x] **Task 3:** Update websocket handlers to store peer ID in room state (COMPLETED)
- [x] **Task 4:** Fix peer ID memory leak (COMPLETED)
- [x] **Task 5:** Create ConnectionRetryManager (COMPLETED)
- [x] **Task 6:** Write unit tests for all changes (COMPLETED)

---

## User Requirements

1. **Stick to PeerJS** - Keep using PeerJS cloud server
2. **Include peer ID in room state** - Late joiners get streamer peer ID from room state
3. **Black screen during transfers** - Kill old stream immediately, show preparing screen
4. **Infinite retry** - Failed connections retry with exponential backoff forever
5. **Unit tests as we go** - Create tests in small increments, streaming is critical

---

## Phase 1: Critical Bug Fixes (Priority: HIGH)

### 1.1 Fix Streamer Ready Race Condition

**Problem:** Streamer emits `peerjs:streamer_ready` synchronously, but PeerJS ID may not be set yet

**Files to modify:**
- `src/hooks/usePeerJS.ts` (lines 227-233)

**Changes:**
```typescript
// Move emission into peer.on('open') callback
peer.on("open", (id) => {
  console.log("[PeerJS] Peer opened with ID:", id);
  setPeerId(id);
  
  // NOW emit ready - guaranteed to have ID
  socket?.emit("peerjs:streamer_ready", {
    roomId,
    peerId: id,
    audioConfig: options.audioConfig,
  });
});
```

**Test file:** `tests/unit/webrtc/streamer-race-condition.test.ts`
- Test that emission happens AFTER peer opens
- Test that multiple rapid starts don't emit multiple events
- Mock PeerJS to simulate delayed open

### 1.2 Add Streamer Peer ID to Room State

**Problem:** Late joiners don't know which PeerJS ID to connect to

**Files to modify:**
1. `websocket/room-state.ts` - Add peerId tracking to RoomState interface
2. `websocket/streaming/events.ts` - Update peer ID storage logic
3. `websocket/db-persistence.ts` - Update serializeRoomState to include peerId

**Changes:**

In `websocket/room-state.ts`:
```typescript
interface RoomState {
  // ... existing fields
  streamerPeerId: string | null; // NEW: Track streamer's PeerJS ID
}
```

In `websocket/streaming/events.ts`:
```typescript
// On peerjs:streamer_ready, update room state
export function updateStreamerPeerId(
  roomId: string,
  userId: string,
  peerId: string
): void {
  const room = roomStates.get(roomId);
  if (room && room.streamerId === userId) {
    room.streamerPeerId = peerId;
  }
}
```

In `websocket/room-state.ts` serializeRoomState:
```typescript
export function serializeRoomState(room: RoomState): SerializedRoomState {
  return {
    // ... existing fields
    streamerPeerId: room.streamerPeerId,
  };
}
```

**Test file:** `tests/unit/websocket/room-state-peerid.test.ts`
- Test that peerId is stored when streamer ready
- Test that peerId is cleared when streamer leaves
- Test that peerId is transferred on streamer change

### 1.3 Fix Peer ID Memory Leak

**Problem:** `roomPeerJSIds` Map in `websocket/streaming/events.ts` never cleaned up

**Files to modify:**
- `websocket/streaming/events.ts` (lines 24, 35-47, 146-151)
- `websocket/room-events.ts` - Call cleanup on leave/disconnect

**Changes:**

Add cleanup call in disconnect handler:
```typescript
// In websocket/room-events.ts handleDisconnect
socket.on("disconnect", () => {
  // ... existing logic
  
  // Clean up peer ID
  const { removePeerId } = await import("./streaming/events");
  removePeerId(roomId, userId);
});
```

**Test file:** `tests/unit/websocket/peerid-cleanup.test.ts`
- Test that peerId is removed on disconnect
- Test that peerId is removed on room leave
- Test Map size doesn't grow unbounded

### 1.4 Implement Infinite Retry Logic

**Problem:** Failed connections don't retry, user sees "Waiting for Stream" forever

**Files to modify:**
- `src/hooks/usePeerJS.ts` - Add retry logic to connectToStreamer
- Create new utility: `src/lib/connection-retry.ts`

**Changes:**

New file `src/lib/connection-retry.ts`:
```typescript
export class ConnectionRetryManager {
  private attempt = 0;
  private baseDelay = 1000;
  private maxDelay = 30000;
  private timer: NodeJS.Timeout | null = null;
  
  async execute<T>(
    operation: () => Promise<T>,
    onAttempt: (attempt: number, delay: number) => void
  ): Promise<T> {
    while (true) {
      try {
        const result = await operation();
        this.reset();
        return result;
      } catch (error) {
        const delay = this.calculateDelay();
        onAttempt(this.attempt, delay);
        await this.wait(delay);
        this.attempt++;
      }
    }
  }
  
  private calculateDelay(): number {
    // Exponential backoff with jitter
    const exponential = this.baseDelay * Math.pow(2, this.attempt);
    const jitter = Math.random() * 1000;
    return Math.min(exponential + jitter, this.maxDelay);
  }
  
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.timer = setTimeout(resolve, ms);
    });
  }
  
  reset(): void {
    this.attempt = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
```

In `usePeerJS.ts`:
```typescript
const retryManager = useRef(new ConnectionRetryManager());

const connectToStreamer = useCallback(async (targetPeerId: string) => {
  setConnectionStatus("connecting");
  
  await retryManager.current.execute(
    async () => {
      // Existing connection logic
      const call = peerRef.current.call(targetPeerId, new MediaStream());
      // ... rest of connection
    },
    (attempt, delay) => {
      console.log(`[PeerJS] Retry attempt ${attempt} in ${delay}ms`);
      setRetryAttempt(attempt);
      setRetryDelay(delay);
    }
  );
}, []);
```

**Test file:** `tests/unit/lib/connection-retry.test.ts`
- Test exponential backoff calculation
- Test infinite retry loop
- Test reset functionality
- Test jitter randomization

**Test file:** `tests/unit/webrtc/infinite-retry.test.ts`
- Test connection retry on failure
- Test status updates during retry
- Test eventual success after retries

---

## Phase 2: Singleton Instance Management (Priority: HIGH)

### 2.1 Create PeerJSContext

**Problem:** Hook called twice creates two PeerJS instances

**Files to create:**
- `src/lib/peerjs-context.tsx` - React Context for PeerJS

**Implementation:**
```typescript
// src/lib/peerjs-context.tsx
import { createContext, useContext, useRef, useCallback } from "react";
import Peer from "peerjs";

interface PeerJSContextType {
  peer: Peer | null;
  initializePeer: (roomId: string, userId: string) => Peer;
  destroyPeer: () => void;
  isInitialized: boolean;
}

const PeerJSContext = createContext<PeerJSContextType | null>(null);

export function PeerJSProvider({ children }: { children: React.ReactNode }) {
  const peerRef = useRef<Peer | null>(null);
  
  const initializePeer = useCallback((roomId: string, userId: string) => {
    if (peerRef.current) {
      console.log("[PeerJS] Reusing existing peer instance");
      return peerRef.current;
    }
    
    const peerId = `${roomId}-${userId}-${Date.now()}`;
    const peer = new Peer(peerId, { debug: 2 });
    peerRef.current = peer;
    
    return peer;
  }, []);
  
  const destroyPeer = useCallback(() => {
    peerRef.current?.destroy();
    peerRef.current = null;
  }, []);
  
  return (
    <PeerJSContext.Provider value={{
      peer: peerRef.current,
      initializePeer,
      destroyPeer,
      isInitialized: !!peerRef.current,
    }}>
      {children}
    </PeerJSContext.Provider>
  );
}

export function usePeerJSContext() {
  const context = useContext(PeerJSContext);
  if (!context) {
    throw new Error("usePeerJSContext must be used within PeerJSProvider");
  }
  return context;
}
```

**Integration:** Wrap room routes with PeerJSProvider in `src/routes/__root.tsx`

**Test file:** `tests/unit/lib/peerjs-context.test.tsx`
- Test singleton behavior (same instance returned)
- Test initialization with correct peer ID
- Test destroy cleans up properly
- Test error on use outside provider

### 2.2 Refactor usePeerJS Hook

**Files to modify:**
- `src/hooks/usePeerJS.ts` - Use context instead of creating own peer

**Changes:**
```typescript
export function usePeerJS(roomId: string, userId: string | undefined) {
  const { initializePeer, destroyPeer, peer: sharedPeer } = usePeerJSContext();
  const peerRef = useRef<Peer | null>(sharedPeer);
  // ... rest of hook using shared peer
}
```

**Test file:** `tests/unit/hooks/use-peerjs-refactor.test.ts`
- Test hook uses context peer
- Test hook doesn't create duplicate peers
- Test cleanup still works

---

## Phase 3: Room State Integration (Priority: HIGH)

### 3.1 Update Room State Types

**Files to modify:**
- `src/types/websocket.ts` - Add streamerPeerId to RoomState
- `websocket/room-state.ts` - Update interface and serialization

**Changes:**

In `src/types/websocket.ts`:
```typescript
export interface RoomState {
  id: string;
  name: string;
  description?: string;
  streamerId: string | null;
  streamerPeerId: string | null; // NEW
  status: RoomStatus;
  participants: Participant[];
  createdAt: Date;
}
```

In `websocket/room-state.ts`:
- Update RoomState interface
- Update serializeRoomState to include streamerPeerId
- Update createRoomState to initialize streamerPeerId as null

**Test file:** `tests/unit/types/room-state-types.test.ts`
- Test type compatibility
- Test serialization/deserialization

### 3.2 Update WebSocket Handlers

**Files to modify:**
- `websocket/streaming/events.ts` - Update peerjs:streamer_ready handler
- `websocket/room-events.ts` - Update streamer transfer logic

**Changes:**

On `peerjs:streamer_ready`:
```typescript
socket.on("peerjs:streamer_ready", (data) => {
  // Store peer ID
  const roomPeers = roomPeerJSIds.get(roomId);
  roomPeers.set(userId, data.peerId);
  
  // Update room state
  const room = roomStates.get(roomId);
  if (room && room.streamerId === userId) {
    room.streamerPeerId = data.peerId;
    
    // Broadcast updated room state
    io.to(roomId).emit("room:state_sync", {
      roomId,
      roomState: serializeRoomState(room),
    });
  }
});
```

On streamer transfer:
```typescript
// In initiateStreamerTransfer
const room = roomStates.get(roomId);
if (room) {
  room.streamerId = newStreamerId;
  room.streamerPeerId = newStreamerPeerId; // Transfer peer ID too
  room.status = "preparing";
}
```

**Test file:** `tests/integration/websocket/peerid-state-sync.test.ts`
- Test peerId in room state after streamer ready
- Test state_sync broadcast on peerId update
- Test peerId transfer on streamer change

### 3.3 Update Client-Side Room Hook

**Files to modify:**
- `src/hooks/useRoom.ts` - Use streamerPeerId from room state
- `src/hooks/usePeerJS.ts` - Auto-connect when peerId available

**Changes:**

In `useRoom.ts`:
```typescript
// Include streamerPeerId in room state
const [roomState, setRoomState] = useState<RoomState | null>(null);

// Auto-trigger connection when streamerPeerId changes
useEffect(() => {
  if (roomState?.streamerPeerId && !isStreamer) {
    // Trigger connection via event or callback
    window.dispatchEvent(new CustomEvent("streamer:peerid_available", {
      detail: { peerId: roomState.streamerPeerId }
    }));
  }
}, [roomState?.streamerPeerId]);
```

In `usePeerJS.ts`:
```typescript
// Listen for peerId from room state
useEffect(() => {
  const handlePeerId = (e: CustomEvent) => {
    connectToStreamer(e.detail.peerId);
  };
  window.addEventListener("streamer:peerid_available", handleCallback);
  return () => window.removeEventListener("streamer:peerid_available", handleCallback);
}, [connectToStreamer]);
```

**Test file:** `tests/unit/hooks/use-room-peerid.test.ts`
- Test auto-connection when peerId appears
- Test re-connection on peerId change

---

## Phase 4: Error Handling & Recovery (Priority: MEDIUM)

### 4.1 Create Error Types

**Files to create:**
- `src/types/streaming-errors.ts` - Error type definitions
- `src/lib/streaming-error-messages.ts` - User-friendly messages

**Implementation:**

```typescript
// src/types/streaming-errors.ts
export enum StreamingErrorType {
  PEER_INIT_FAILED = "peer_init_failed",
  SCREEN_CAPTURE_DENIED = "screen_capture_denied",
  SCREEN_CAPTURE_FAILED = "screen_capture_failed",
  CONNECTION_FAILED = "connection_failed",
  CONNECTION_LOST = "connection_lost",
  CONNECTION_TIMEOUT = "connection_timeout",
  STREAMER_TRANSFER_FAILED = "transfer_failed",
  STREAM_ENDED_UNEXPECTEDLY = "stream_ended",
  PEERJS_ERROR = "peerjs_error",
  UNKNOWN = "unknown",
}

export interface StreamingError {
  type: StreamingErrorType;
  message: string;
  recoverable: boolean;
  timestamp: number;
}
```

```typescript
// src/lib/streaming-error-messages.ts
export const streamingErrorMessages: Record<StreamingErrorType, string> = {
  [StreamingErrorType.PEER_INIT_FAILED]: 
    "Failed to initialize streaming service. Please refresh and try again.",
  [StreamingErrorType.SCREEN_CAPTURE_DENIED]: 
    "Screen sharing was cancelled. Click 'Start Streaming' to try again.",
  [StreamingErrorType.SCREEN_CAPTURE_FAILED]: 
    "Failed to capture screen. Please check your permissions and try again.",
  [StreamingErrorType.CONNECTION_FAILED]: 
    "Failed to connect to stream. Retrying...",
  [StreamingErrorType.CONNECTION_LOST]: 
    "Connection lost. Attempting to reconnect...",
  [StreamingErrorType.CONNECTION_TIMEOUT]: 
    "Connection timed out. Checking network...",
  [StreamingErrorType.STREAMER_TRANSFER_FAILED]: 
    "Failed to switch to new streamer. Waiting for stream...",
  [StreamingErrorType.STREAM_ENDED_UNEXPECTEDLY]: 
    "Stream ended unexpectedly. Waiting for it to resume...",
  [StreamingErrorType.PEERJS_ERROR]: 
    "Streaming service error. Reconnecting...",
  [StreamingErrorType.UNKNOWN]: 
    "An unexpected error occurred. Retrying...",
};
```

**Test file:** `tests/unit/types/streaming-errors.test.ts`
- Test error type completeness
- Test message mapping
- Test error creation

### 4.2 Add Error Boundary

**Files to create:**
- `src/components/StreamingErrorBoundary.tsx`

**Implementation:**
```typescript
export class StreamingErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error, errorInfo) {
    console.error("[StreamingError]", error, errorInfo);
    // Log to analytics
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="streaming-error">
          <h3>Streaming Error</h3>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

**Test file:** `tests/unit/components/streaming-error-boundary.test.tsx`
- Test error catching
- Test fallback UI
- Test retry functionality

---

## Phase 5: UI Improvements (Priority: MEDIUM)

### 5.1 Connection Status Indicators

**Files to modify:**
- `src/components/VideoDisplay.tsx` - Add status overlays
- `src/routes/room.$roomId.tsx` - Show connection status

**Implementation:**

Enhanced VideoDisplay with status:
```typescript
interface VideoDisplayProps {
  stream: MediaStream | null;
  streamerName: string | undefined;
  connectionStatus: ConnectionStatus;
  retryAttempt?: number;
}

function VideoDisplay({ stream, streamerName, connectionStatus, retryAttempt }: VideoDisplayProps) {
  if (!stream) {
    switch (connectionStatus) {
      case "connecting":
        return (
          <div className="video-placeholder">
            <LoadingSpinner />
            <p>Connecting to stream...</p>
            {retryAttempt > 0 && (
              <p className="text-sm text-gray-500">
                Retry attempt {retryAttempt}
              </p>
            )}
          </div>
        );
      case "failed":
        return (
          <div className="video-placeholder">
            <ConnectionFailedIcon />
            <p>Connection failed. Retrying...</p>
          </div>
        );
      default:
        return (
          <div className="video-placeholder">
            <WaitingIcon />
            <p>Waiting for Stream</p>
          </div>
        );
    }
  }
  
  return <video ref={videoRef} autoPlay playsInline />;
}
```

**Test file:** `tests/unit/components/video-display-status.test.tsx`
- Test each status state rendering
- Test retry attempt display
- Test stream playback when connected

### 5.2 Create TransferOverlay

**Files to create:**
- `src/components/TransferOverlay.tsx`
- `src/components/TransferOverlay.test.tsx`

**Implementation:**
```typescript
interface TransferOverlayProps {
  isTransferring: boolean;
  oldStreamerName?: string;
  newStreamerName?: string;
  progress?: number;
}

export function TransferOverlay({ 
  isTransferring, 
  oldStreamerName, 
  newStreamerName,
  progress 
}: TransferOverlayProps) {
  if (!isTransferring) return null;
  
  return (
    <div className="transfer-overlay">
      <div className="transfer-content">
        <StreamerChangeIcon />
        <h3>Streamer Changed</h3>
        <p>
          {oldStreamerName} has left. 
          {newStreamerName && ` ${newStreamerName} is now streaming.`}
        </p>
        <LoadingSpinner />
        <p className="text-sm">Connecting to new stream...</p>
        {progress !== undefined && (
          <ProgressBar value={progress} max={100} />
        )}
      </div>
    </div>
  );
}
```

**Usage in room.$roomId.tsx:**
```typescript
const isTransferring = transferState === "initiating" || transferState === "reconnecting";

return (
  <div className="video-container">
    <VideoDisplay stream={remoteStream} ... />
    <TransferOverlay 
      isTransferring={isTransferring}
      oldStreamerName={previousStreamerName}
      newStreamerName={currentStreamerName}
    />
  </div>
);
```

**Test file:** `tests/unit/components/transfer-overlay.test.tsx`
- Test visibility based on isTransferring
- Test message content with names
- Test progress bar display

### 5.3 Toast Notification System

**Files to create:**
- `src/lib/toast-context.tsx` - Toast state management
- `src/components/ToastContainer.tsx` - Toast UI
- `src/hooks/useStreamingToasts.ts` - Streaming-specific toasts

**Implementation:**

```typescript
// src/hooks/useStreamingToasts.ts
export function useStreamingToasts() {
  const { addToast } = useToast();
  
  useEffect(() => {
    // Listen for streaming events
    socket?.on("room:streamer_changed", (data) => {
      addToast({
        type: "info",
        message: `${data.newStreamerName} is now the streamer`,
        duration: 5000,
      });
    });
    
    socket?.on("peerjs:screen_share_ended", () => {
      addToast({
        type: "warning",
        message: "Screen sharing ended",
        duration: 3000,
      });
    });
    
    // Connection events
    const handleConnected = () => {
      addToast({
        type: "success",
        message: "Connected to stream",
        duration: 3000,
      });
    };
    
    window.addEventListener("peerjs:connected", handleConnected);
    
    return () => {
      window.removeEventListener("peerjs:connected", handleConnected);
    };
  }, [socket, addToast]);
}
```

**Test file:** `tests/unit/hooks/use-streaming-toasts.test.ts`
- Test toast on streamer change
- Test toast on stream end
- Test toast on connection

---

## Implementation Order

### Sprint 1 (Days 1-3): Critical Fixes + Tests
1. Day 1: Fix streamer ready race condition + tests
2. Day 2: Add peer ID to room state + tests
3. Day 3: Fix peer ID memory leak + infinite retry + tests

### Sprint 2 (Days 4-5): Context + Tests
4. Day 4: Create PeerJSContext + tests
5. Day 5: Refactor usePeerJS to use context + tests

### Sprint 3 (Days 6-8): Room State Integration + Tests
6. Day 6: Update room state types + tests
7. Day 7: Update websocket handlers + tests
8. Day 8: Update client hooks + integration tests

### Sprint 4 (Days 9-10): Error Handling + Tests
9. Day 9: Error types and messages + tests
10. Day 10: Error boundary + tests

### Sprint 5 (Days 11-13): UI + Tests
11. Day 11: Connection status indicators + tests
12. Day 12: TransferOverlay + tests
13. Day 13: Toast system + tests

### Sprint 6 (Days 14-15): Final Testing
14. Day 14: Run all tests, fix failures
15. Day 15: E2E testing, documentation

---

## Testing Strategy

### Unit Test Requirements
- **Minimum 90% coverage** (matching existing standard)
- Tests for all new utility functions
- Tests for all React hooks
- Tests for all UI components
- Mock PeerJS and Socket.io

### Test File Structure
```
tests/unit/
├── webrtc/
│   ├── streamer-race-condition.test.ts
│   ├── infinite-retry.test.ts
│   └── use-peerjs-refactor.test.ts
├── websocket/
│   ├── room-state-peerid.test.ts
│   └── peerid-cleanup.test.ts
├── lib/
│   ├── connection-retry.test.ts
│   ├── peerjs-context.test.tsx
│   └── streaming-error-messages.test.ts
├── hooks/
│   ├── use-room-peerid.test.ts
│   └── use-streaming-toasts.test.ts
├── components/
│   ├── video-display-status.test.tsx
│   ├── transfer-overlay.test.tsx
│   └── streaming-error-boundary.test.tsx
└── types/
    ├── room-state-types.test.ts
    └── streaming-errors.test.ts
```

### Integration Tests
- `tests/integration/websocket/peerid-state-sync.test.ts`
- Test full flow: streamer starts -> peerId in state -> viewer connects

---

## Files Summary

### Modified Files (18 total)
1. `src/hooks/usePeerJS.ts` - Core hook refactoring
2. `src/hooks/useRoom.ts` - Room state integration
3. `src/routes/room.$roomId.tsx` - Video display updates
4. `src/routes/__root.tsx` - Add PeerJSProvider
5. `websocket/room-state.ts` - Add peerId tracking
6. `websocket/room-events.ts` - Cleanup on disconnect
7. `websocket/streaming/events.ts` - Peer ID management
8. `websocket/db-persistence.ts` - Serialize peerId
9. `src/types/websocket.ts` - Type updates

### New Files (10 total)
1. `src/lib/peerjs-context.tsx` - Singleton context
2. `src/lib/connection-retry.ts` - Retry manager
3. `src/types/streaming-errors.ts` - Error types
4. `src/lib/streaming-error-messages.ts` - Error messages
5. `src/components/StreamingErrorBoundary.tsx` - Error boundary
6. `src/components/TransferOverlay.tsx` - Transfer UI
7. `src/lib/toast-context.tsx` - Toast system
8. `src/components/ToastContainer.tsx` - Toast UI
9. `src/hooks/useStreamingToasts.ts` - Toast hook

### Test Files (15 total)
15 new test files covering all changes

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PeerJSContext breaks existing code | High | Gradual migration, keep backward compat |
| Room state changes break websocket | High | Thorough integration testing |
| Infinite retry causes resource exhaustion | Medium | Add maxDelay cap (30s) |
| Memory leak still exists | Medium | Test cleanup in all scenarios |
| Tests don't cover edge cases | Medium | Review coverage reports |

---

## Success Criteria

1. **All 6 critical bugs fixed** with tests
2. **No duplicate PeerJS instances** (verified in tests)
3. **Late joiners auto-connect** to stream
4. **Failed connections retry infinitely** with backoff
5. **Streamer transfers show overlay** with smooth transition
6. **90%+ test coverage maintained**
7. **All existing tests pass**
8. **E2E tests pass**

---

## Questions for Review

Before starting implementation, please confirm:

1. **Sprint duration** - Is 15 days realistic, or should we adjust?
2. **Toast library** - Should we use existing toast system or create new one?
3. **Error analytics** - Should we track errors to analytics service?
4. **Feature flags** - Should we use feature flags for gradual rollout?
5. **Database migration** - Do we need migration for any schema changes?

**Next Steps:**
- [ ] Review and approve plan
- [ ] Confirm sprint schedule
- [ ] Begin Sprint 1: Critical Fixes
