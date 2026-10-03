# Architecture decision records

| # | Decision |
|---|---|
| [1](0001-p2p-mesh-media.md) | P2P WebRTC full mesh for media; server does signalling + DB only |
| [2](0002-room-caps-and-quality.md) | 10 people, 3 streamers; 720p30–1080p60 adaptive; best codec per pair; cams 360p15; share audio |
| [3](0003-nat-traversal.md) | STUN + pluggable TURN; Cloudflare TURN free tier from day one |
| [4](0004-signalling-websocket.md) | WebSocket in app server for signalling, presence, chat (last 50 in RAM) |
| [5](0005-tanstack-start.md) | TanStack Start |
| [6](0006-open-discord-signin.md) | Any Discord user can sign in; env-bootstrapped admins; no bot integration yet |
| [7](0007-better-auth.md) | Better Auth (Discord, Drizzle, admin plugin, rate limit) |
| [8](0008-postgres-drizzle.md) | Postgres + Drizzle |
| [9](0009-homelab-hosting.md) | Homelab Docker Compose + Cloudflare Tunnel |
| [10](0010-thumbnails.md) | Streamer-captured WebP thumbnails every 3 min, Postgres bytea |
| [11](0011-data-retention.md) | Room data purged after 30 days; aggregate stats persist; stat definitions |
| [12](0012-presence-event-source.md) | Server WS lifecycle is source of truth for join/leave/stream events |
| [13](0013-ui-port.md) | Port design as-is + Base UI primitives; settings in DB + cache; id-keyed profile URLs |
| [14](0014-room-lifecycle.md) | Room ends after 5 min empty; host grace 30s then longest-present |
| [15](0015-room-moderation.md) | Host/mod/admin moderation powers |
| [16](0016-private-rooms.md) | Private rooms: invite link + host approval |
| [17](0017-browser-support.md) | Desktop Chromium + Firefox; mobile can't share |
| [18](0018-tooling.md) | pnpm, Biome, Vitest, Playwright |
| [19](0019-favorites-and-notifications.md) | Favorites are a badge; no notifications |
| [20](0020-anonymous-lobby-socket.md) | Anonymous read-only lobby socket for visitors; upgrade on sign-in |
| [21](0021-one-room-connection.md) | One room connection per user (takeover); full rooms refuse |
| [22](0022-link-embeds.md) | Link embeds: OG/Twitter tags per page, satori + resvg room cards, nothing private in a tag |
