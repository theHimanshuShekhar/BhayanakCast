# BhayanakCast — domain context

Small-group live screen-sharing hangouts. Anyone signs in with Discord, starts or joins a **room**, and up to 3 people share their screens to up to 10 people over peer-to-peer WebRTC. Decisions live in [docs/adr](docs/adr/README.md). The UI source of truth is the claude.ai/design project `BhayanakCast.html`.

## Glossary
- **Room**: a live hangout, capped at 10 people. It is *live* while occupied, *idle* while empty (up to 5 min), and then *ended*. An admin can end any live room at once, which sends everyone in it home.
- **Past stream**: an ended room. Its recap is kept for 30 days.
- **Host**: the room's owner role, which can transfer (ADR 14). **Mod**: a member promoted by the host. **Viewer/member**: everyone else in the room.
- **Streamer**: a participant currently sharing their screen. At most 3 per room.
- **Stream**: one screen-share (video + optional share audio) from one streamer.
- **Knock**: a request to join a private room through its invite link, waiting for host/mod approval.
- **Presence interval**: a continuous span during which a user is in a room, from join to leave, with a 30s reconnect grace.
- **Stream interval**: a span during which a user is streaming in a room.
- **Recap**: the past-stream page, showing who joined and for how long, and who streamed and for how long. It has no chat.
- **Co-time**: total seconds two users have spent in the same room at the same time. It persists forever.
- **Stats**: per-user lifetime aggregates (hours streamed/watched, rooms hosted/joined, peak viewers) and platform daily counters. They include rooms in progress, and persist forever.
- **Thumbnail**: a still captured by a streamer's browser every 3 min, used in room card mosaics.
- **Mesh**: one RTCPeerConnection between every pair of participants.
- **Online user**: a signed-in user with an open connection, whether or not they are in a room. The side rail's count adds the online visitors to these (see **Online count**).
- **Visitor**: someone not signed in. They can browse home, profiles and recaps, but must sign in to enter a room. An online visitor counts once per browser (several tabs are one, a private window is another), by a random id the browser keeps.
- **Online count**: the distinct online users plus the online visitors, as one number. The side rail and the home "Online" tile show it.
- **Lobby**: the pre-join check before entering a room, where the user picks and previews devices. Mic and camera start off.
- **Takeover**: joining from a new tab or device ends the user's previous room connection. A user is in at most one room at a time.
- **Admin**: a site-wide role with access to `/admin`, bans, and moderation in any room. Admins promote and demote each other from `/admin`.
- **Env admin**: an admin listed in `ADMIN_DISCORD_IDS`. They're granted the role at every sign-in and can't be demoted.
- **Ban**: a site-wide block an admin puts on a user, with a reason and an optional expiry. It signs them out and removes them from any live room at once. Admins can't be banned.
- **Audit log**: the record of every admin action (who, what, on whom or which room, when). It is kept indefinitely.

## Stack at a glance
TanStack Start (React 19, Vite) · Tailwind v4 + Base UI · WebSocket signalling in the same Node process · native WebRTC full mesh · STUN + Cloudflare TURN · Better Auth (Discord) · Postgres + Drizzle · Docker Compose on the homelab behind Cloudflare Tunnel · pnpm, Biome, Vitest, Playwright.
