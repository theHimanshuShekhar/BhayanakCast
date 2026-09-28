# 9. Homelab hosting with Docker Compose and Cloudflare Tunnel

Date: 2026-09-27 · Status: accepted

## Decision
Deploy on the homelab as Docker Compose: `app` (TanStack Start Node server with WebSocket) and `postgres`. Expose it publicly through a Cloudflare Tunnel (`cloudflared`), which provides TLS and WebSocket support without port forwarding.

## Consequences
- The server handles only HTTP, WebSocket signalling and DB work; media is peer-to-peer (ADR 1), with Cloudflare TURN as relay (ADR 3). Home uplink is not a media bottleneck.
- Availability depends on home uptime. A restart drops live room state; clients reconnect (ADR 4).
- Cloudflare Tunnel may close idle WebSockets, so the client and server exchange heartbeats (ping every ~30s).

## Addendum: deployment and storage (2026-09-27)
- Deployed as a **git-backed stack on Dockhand**, which builds from this repo's compose file on the dockhand LXC, like llm-gateway. The app binds to the LAN IP.
- Uses the homelab's **existing shared cloudflared**, with public hostname `cast.bhayanak.net` pointing at the app's LAN port. This stack has no cloudflared service of its own.
- Postgres data lives on a **local Docker volume**, never on the NAS CIFS share. Postgres needs working fsync, locking and Unix permissions, which CIFS doesn't provide, so running it there risks silent corruption.
- A small sidecar writes a nightly compressed `pg_dump` and rsyncs the dump directory to the NAS CIFS share, keeping 14 days. The raw data directory is never rsynced, because a live copy isn't restorable.

## Addendum: one origin for pages and the socket (2026-09-28)
The realtime WebSocket (`/ws`) runs on the same port and hostname as the app, so the single tunnel public hostname `cast.bhayanak.net` carries both HTTPS pages and `wss://…/ws`. No second tunnel route is needed. Don't override the tunnel's HTTP Host header: the socket's same-origin check compares the page's Origin with the Host it receives.

## Addendum: client IP behind the tunnel (2026-09-28)
The app is published on the LAN IP, so a LAN client can reach it directly and send its own `cf-connecting-ip`. The header is trusted only when the direct peer is listed in `TRUSTED_PROXY_IPS` (the shared cloudflared host; required in production); from anyone else the socket address is the client IP. This covers the per-IP limit on anonymous sockets (ADR 20) and Better Auth's rate limiter, which reads only headers, so the production server rewrites `cf-connecting-ip` to the resolved IP before any handler runs. `pnpm dev` doesn't rewrite it.
