> **Historical planning document.** This describes a manual RTCPeerConnection architecture that was never implemented. The actual implementation uses PeerJS — see [README.md](./README.md).

## 11. Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Create `src/hooks/useWebRTC.ts` with basic connection management
- [ ] Implement `cleanupAsStreamer()` and `cleanupAsViewer()`
- [ ] Add WebRTC state types and interfaces
- [ ] Set up Socket.io event handlers in `websocket/websocket-server.ts`
- [ ] Add TypeScript types for all WebRTC events
- [ ] Create `roomWebRTCState` Map for server-side tracking
- [ ] Implement `startTransferTimeout()` function

### Phase 2: Transfer Logic
- [ ] Modify server disconnect handler to emit WebRTC events
- [ ] Add `webrtc:transfer_initiating` event emission
- [ ] Implement new streamer initialization flow (`webrtc:become_streamer`)
- [ ] Add viewer reconnection logic (`webrtc:reconnect_now`)
- [ ] Set up signaling message forwarding (offer/answer/ICE)
- [ ] Add transfer debouncing for rapid changes
- [ ] Implement `handleStreamerInitFailure()` fallback

### Phase 3: UI Integration
- [ ] Create `TransferOverlay` component
- [ ] Implement video component with poster states
- [ ] Add connection status indicators
- [ ] Style transfer overlay with spinner animation
- [ ] Create `StreamContainer` component
- [ ] Add browser compatibility check
- [ ] Implement permission denial UI

### Phase 4: Error Handling
- [ ] Add retry logic with exponential backoff
- [ ] Implement ICE restart on failure
- [ ] Add server-side transfer timeout (10s)
- [ ] Handle permission denial gracefully
- [ ] Add connection state monitoring
- [ ] Implement `handleConnectionFailure()` recovery
- [ ] Add WebRTC feature detection

### Phase 5: Testing
- [ ] Test normal streamer transfer (1 viewer)
- [ ] Test with multiple viewers (5+)
- [ ] Test rapid streamer changes (A->B->C)
- [ ] Test network disconnection during transfer
- [ ] Test browser refresh during transfer
- [ ] Test permission denial flow
- [ ] Test with unsupported browsers
- [ ] Test TURN server fallback
- [ ] Load test with 20+ concurrent rooms

### Phase 6: Monitoring & Analytics
- [ ] Add WebRTC connection metrics logging
- [ ] Track transfer success/failure rates
- [ ] Monitor ICE connection times
- [ ] Log reconnection attempts
- [ ] Add client-side error reporting
- [ ] Track average transfer duration

## Key Timing Constants

```typescript
// Timing configuration
const TIMING = {
  // How long old streamer has to clean up
  CLEANUP_TIMEOUT: 500, // ms
  
  // Delay before new streamer starts
  NEW_STREAMER_DELAY: 600, // ms
  
  // Time for new streamer to prepare
  STREAMER_PREPARE_TIME: 900, // ms
  
  // Delay before viewers reconnect
  RECONNECT_DELAY: 1500, // ms
  
  // Total expected transfer time
  TOTAL_TRANSFER_TIME: 5000, // ms
  
  // Server timeout for entire transfer
  SERVER_TRANSFER_TIMEOUT: 10000, // ms
  
  // Reconnection retry delay (exponential)
  RETRY_BASE_DELAY: 2000, // ms
  
  // Max reconnection attempts
  MAX_RETRY_ATTEMPTS: 3,
  
  // Debounce time for rapid transfers
  TRANSFER_DEBOUNCE: 500, // ms
};
```

## File Structure

```
src/
├── hooks/
│   └── useWebRTC.ts              # Main WebRTC hook
├── components/
│   ├── StreamContainer.tsx       # Video + overlay wrapper
│   ├── TransferOverlay.tsx       # Transfer status UI
│   ├── LocalVideo.tsx            # Streamer video display
│   └── RemoteVideo.tsx           # Viewer video display
├── types/
│   └── webrtc.ts                 # WebRTC type definitions
└── styles/
    └── stream.css                # Stream styling

websocket/
└── websocket-server.ts           # Add WebRTC event handlers
```

## Summary

This plan provides a complete, production-ready solution for handling WebRTC P2P mesh connections during streamer transfers. Key features:

1. **Graceful Teardown**: Clean connection closure with data channel notifications
2. **Synchronized Reconnection**: Server-coordinated timing prevents race conditions
3. **State Management**: Clear state machine tracks transfer progress
4. **Error Recovery**: Retry logic with exponential backoff and ICE restart
5. **Edge Case Handling**: Covers permission denial, network failures, rapid transfers
6. **UI Feedback**: Users see clear status throughout the transfer process

The 5-phase timing sequence (0ms-5000ms) ensures all clients coordinate their actions without conflicts, while the error handling and edge case solutions make the system robust for real-world usage.
