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
