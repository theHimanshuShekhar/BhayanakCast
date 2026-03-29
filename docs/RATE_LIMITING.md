# Rate Limiting

All rate limits use a sliding window algorithm and are defined in `src/lib/rate-limiter.ts` (`RateLimits` constant).

## Limits

### Room Operations (WebSocket)

| Action | Limit | Window | Rationale |
|--------|-------|--------|-----------|
| `ROOM_CREATE` | 3 | 60s | Expensive DB operation |
| `ROOM_JOIN` | 10 | 60s | Allows browsing rooms |
| `ROOM_LEAVE` | 5 | 60s | Less frequent than joins |
| `STREAMER_TRANSFER` | 1 | 30s | Per `roomId:userId` — deliberate action |

### Chat (WebSocket)

| Action | Limit | Window | Rationale |
|--------|-------|--------|-----------|
| `CHAT_SEND` | 30 | 15s | ~120/min — allows active chat |
| `CHAT_RAPID` | 5 | 3s | Catches micro-burst spam |

### Streaming (WebSocket)

| Action | Limit | Window | Rationale |
|--------|-------|--------|-----------|
| `WEBRTC_SIGNALING` | 200 | 60s | Applied to all 3 PeerJS events |

### Connections

| Action | Limit | Window | Rationale |
|--------|-------|--------|-----------|
| `WS_CONNECTION` | 30 | 60s | Per IP, accounts for shared IPs |

## Implementation

**Sliding window:** Tracks request timestamps, expires old entries. More accurate than fixed windows — prevents burst abuse at window boundaries.

**Namespacing:** Each action has its own namespace, so hitting chat limits doesn't affect room limits.

**Keying:** Most limits are per-userId. `STREAMER_TRANSFER` is keyed `${roomId}:${userId}` to prevent cross-room interference. Connection limits are per-IP.

**Error response:**
```typescript
{
  message: "You're sending messages too quickly. Try again in 12 seconds.",
  retryAfter: 12
}
```

## Multi-Server Scaling

Swap `InMemoryBackend` for `ValkeyBackend` in `RateLimiter.getInstance()` and all limits automatically become distributed. No changes needed in consumers.

## See Also
- `src/lib/rate-limiter.ts` — all definitions and backends
- [Room System](./ROOM_SYSTEM.md) — room operation limits
- [WebSocket Events](./WEBSOCKET_EVENTS.md) — event documentation
