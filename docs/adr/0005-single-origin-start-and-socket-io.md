# Single-origin TanStack Start and Socket.IO

BhayanakCast will run the TanStack Start web app and Socket.IO signaling on the same HTTP origin and port, so deployment can expose a single address through a cloudflared tunnel. The v1 runtime and package manager are Node.js and pnpm; Socket.IO attaches to the same HTTP server used by the TanStack Start app for realtime room coordination and WebRTC signaling.

## Consequences

- Browser clients use the same origin for app HTTP routes and Socket.IO connections.
- Local and tunneled development need only one exposed port.
- The app and PostgreSQL run in Docker Compose; PostgreSQL is reachable only from the app backend over Docker internal networking.
- Horizontal scaling still requires the Socket.IO shared-adapter decision from ADR-0003.
- Valkey is part of the v1 Docker Compose stack for rate limiting only. It is not the primary cache, queue, or Socket.IO adapter unless a later ADR expands its role.
