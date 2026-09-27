# 9. Homelab hosting with Docker Compose and Cloudflare Tunnel

Date: 2026-09-27 · Status: accepted

## Decision
Deploy on the homelab as Docker Compose: `app` (TanStack Start Node server with WebSocket) and `postgres`. Expose it publicly through a Cloudflare Tunnel (`cloudflared`), which provides TLS and WebSocket support without port forwarding.

## Consequences
- The server handles only HTTP, WebSocket signalling and DB work; media is peer-to-peer (ADR 1), with Cloudflare TURN as relay (ADR 3). Home uplink is not a media bottleneck.
- Availability depends on home uptime. A restart drops live room state; clients reconnect (ADR 4).
- Cloudflare Tunnel may close idle WebSockets, so the client and server exchange heartbeats (ping every ~30s).
