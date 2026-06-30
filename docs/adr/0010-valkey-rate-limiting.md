# Valkey rate limiting

BhayanakCast includes Valkey in the v1 Docker Compose stack specifically for rate limiting. Valkey is not a general cache, queue, primary data store, or Socket.IO adapter unless a later ADR expands its role.

## Consequences

- Rate limits apply to core abuse surfaces only: room creation, chat messages, report creation, stream thumbnail upload, stream start/stop commands, and private-room password attempts.
- WebRTC signaling and ICE candidate relay must not be blanket-rate-limited in a way that breaks peer connection setup.
- Default limits are conservative and testable:
  - Room creation: 5 per hour per account.
  - Chat: 30 messages per minute per account per room.
  - Reports: 10 per hour per account.
  - Stream thumbnails: 1 every 110 seconds per stream session, with the existing 100 KB payload cap.
  - Stream start/stop commands: 10 per minute per account per room.
  - Private-room password attempts: 10 per 10 minutes per account + room + IP.
- Rate-limit failures return stable application error codes through HTTP responses or Socket.IO command acks; they must not crash sockets or silently drop user actions.
