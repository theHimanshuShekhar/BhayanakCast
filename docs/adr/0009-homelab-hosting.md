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

## Addendum: the backup sidecar mounts the NAS itself (2026-09-30)
The sidecar's NAS directory is a Docker `cifs` volume of the `local` driver in the compose file, not a bind mount of a share the host mounts. Docker mounts it whenever the sidecar starts, so it needs no host fstab entry and survives reboots, and an unreachable share stops the sidecar instead of letting it write to an empty local mount point. The NAS account's credentials are stack variables. Postgres data stays on its local volume.

## Addendum: backup health must mean a recent backup (2026-10-02)
The sidecar's healthcheck no longer trusts an old "ok". The status file carries the finish time, and the check fails once it is older than `BACKUP_MAX_AGE_HOURS` (default 26), so a stopped schedule shows as unhealthy and not as healthy forever. `pg_dump` and `rsync` run under timeouts so a hung run fails and frees the run lock, and each run clears the temp files an interrupted one left. These are additions to the 2026-09-27 and 2026-09-30 decisions, which stand: local-volume Postgres, dumps rsynced to the NAS, and the Docker-mounted `cifs` volume. An unreachable NAS still stops only the sidecar; the app and `db` start (docs/deploy.md section 5).
