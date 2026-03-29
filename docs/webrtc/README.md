# Streaming Architecture (PeerJS)

BhayanakCast uses **PeerJS** as a WebRTC abstraction layer for P2P screen sharing. The files in this directory (`01-07`) are historical planning documents from before the PeerJS decision and describe a manual RTCPeerConnection architecture that was **never implemented**. They are kept for reference only.

---

## How It Works

Streaming is layered on top of the WebSocket room system:

```
1. Streamer gets Peer instance (singleton via PeerJSContext in __root.tsx)
2. On peer.on("open") → emits peerjs:streamer_ready { roomId, peerId }
3. Server stores peerId in RoomState.streamerPeerId → broadcasts room:state_sync
4. Viewers receive streamerPeerId from room state → call connectToStreamer(peerId)
5. PeerJS handles WebRTC offer/answer/ICE → P2P stream established
6. Viewer receives MediaStream → displayed in VideoDisplay component
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/peerjs-context.tsx` | PeerJS singleton — prevents duplicate `Peer` instances |
| `src/hooks/usePeerJS.ts` | Main streaming hook for both streamers and viewers |
| `src/lib/connection-retry.ts` | Exponential backoff retry with jitter and abort support |
| `src/types/webrtc.ts` | `ConnectionStatus` type (single canonical definition) |
| `src/components/ScreenSharePreview.tsx` | Streamer local preview |
| `src/components/VideoDisplay.tsx` | Viewer video + connection status overlays |
| `src/components/TransferOverlay.tsx` | UI shown during streamer transfer |
| `websocket/streaming/events.ts` | Server-side PeerJS event handlers |
| `websocket/streaming/types.ts` | Streaming event payload types |

## Streamer Flow

```typescript
// usePeerJS.ts — startScreenShare()
const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
const peer = getOrCreatePeer(); // from PeerJSContext

peer.on("open", (peerId) => {
  socket.emit("peerjs:streamer_ready", { roomId, peerId, audioConfig });
});

peer.on("call", (call) => {
  call.answer(stream); // Answer incoming viewer connections
});
```

## Viewer Flow

```typescript
// usePeerJS.ts — connectToStreamer()
const peer = getOrCreatePeer();
const call = peer.call(streamerPeerId, emptyStream);

call.on("stream", (remoteStream) => {
  setRemoteStream(remoteStream);
  setConnectionStatus("connected");
});
```

## Late-Joiner Auto-Connect

Viewers who join after the streamer is already ready connect automatically via `streamerPeerId` from room state — no new event needed:

```typescript
// usePeerJS.ts
useEffect(() => {
  if (!streamerPeerId || isStreamer) return;
  void connectToStreamer(streamerPeerId);
}, [streamerPeerId]);
```

## Streamer Transfer

When the streamer leaves:
1. Server emits `peerjs:streamer_changed` to all clients with `newStreamerPeerId: string | null`
2. If `null`: viewers wait for next `room:state_sync` (new streamer hasn't called `peerjs:streamer_ready` yet)
3. If set: viewers immediately reconnect
4. `useRoom` resets `streamerPeerId` to `null` on `room:streamer_changed` to prevent stale connections

## Retry / Error Recovery

`ConnectionRetryManager` (`src/lib/connection-retry.ts`) provides:
- Exponential backoff with jitter
- Configurable max retries
- Abort support (on unmount)
- `retryAttempt` count exposed to UI for status display

Connection errors are handled silently — retry in background, show subtle spinner.

## PeerJS Cloud Server

Uses the default PeerJS cloud signaling server. No self-hosted TURN/STUN needed for typical room sizes (2–12 users).

## See Also
- [WebSocket Events](../WEBSOCKET_EVENTS.md) — PeerJS event payloads
- [WebSocket Architecture](../WEBSOCKET_ARCHITECTURE.md) — PeerJS in context
