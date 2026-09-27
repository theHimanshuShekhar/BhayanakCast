# BhayanakCast — domain context

Small-group live screen-sharing hangouts. Anyone signs in with Discord, starts or joins a **room**, and up to 3 people share their screens to up to 10 people over peer-to-peer WebRTC. Decisions live in [docs/adr](docs/adr/README.md). The UI source of truth is the claude.ai/design project `BhayanakCast.html`.

## Glossary
- **Room**: a live hangout, capped at 10 people. It is *live* while occupied, *idle* while empty (up to 5 min), and then *ended*.
- **Past stream**: an ended room. Its recap is kept for 30 days.
- **Host**: the room's owner role, which can transfer (ADR 14). **Mod**: a member promoted by the host. **Viewer/member**: everyone else in the room.
- **Streamer**: a participant currently sharing their screen. At most 3 per room.
- **Stream**: one screen-share (video + optional share audio) from one streamer.
- **Knock**: a request to join a private room through its invite link, waiting for host/mod approval.
- **Presence interval**: a continuous span during which a user is in a room, from join to leave, with a 30s reconnect grace.
- **Stream interval**: a span during which a user is streaming in a room.
- **Recap**: the past-stream page, showing who joined and for how long, and who streamed and for how long. It has no chat.
- **Co-time**: total seconds two users have spent in the same room at the same time. It persists forever.
- **Stats**: per-user lifetime aggregates (hours streamed/watched, rooms hosted/joined, peak viewers) and platform daily counters. They persist forever.
- **Thumbnail**: a still captured by a streamer's browser every 3 min, used in room card mosaics.
- **Mesh**: one RTCPeerConnection between every pair of participants.
- **Admin**: a site-wide role with access to `/admin`, bans, and moderation in any room.

## Stack at a glance
TanStack Start (React 19, Vite) · Tailwind v4 + Base UI · WebSocket signalling in the same Node process · native WebRTC full mesh · STUN + Cloudflare TURN · Better Auth (Discord) · Postgres + Drizzle · Docker Compose on the homelab behind Cloudflare Tunnel · pnpm, Biome, Vitest, Playwright.
