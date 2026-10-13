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
- **Co-time**: total seconds two users have spent in the same room at the same time. It persists forever. Profiles list co-users from public rooms only (admins see all).
- **Stats**: per-user lifetime aggregates (hours streamed/watched, rooms hosted/joined, peak viewers) and platform daily counters. They include rooms in progress, and persist forever. A profile or search result shows only public-room stats (admins see all); community totals count every room.
- **Thumbnail**: a still captured by a streamer's browser every 3 min, used in room card mosaics.
- **Mesh**: one RTCPeerConnection between every pair of participants.
- **Online user**: a signed-in user with an open connection, whether or not they are in a room. The side rail's count adds the online visitors to these (see **Online count**).
- **Visitor**: someone not signed in. They can browse home, profiles and recaps, but must sign in to enter a room. An online visitor counts once per browser (several tabs are one, a private window is another), by a random id the browser keeps.
- **Online count**: the distinct online users plus the online visitors, as one number. The side rail and the home "Online" tile show it.
- **Lobby**: the realtime home channel (ADR 20). Every page keeps a socket open to it, signed in or not, and it carries only public, list-level events: the online count and public room list changes (`lobby.changed`, `lobby-live.ts`). It has nothing to do with joining a room.
- **Pre-join**: the device check before entering a room, where the user picks and previews devices. Mic and camera start off. The `Lobby` component (`components/room/lobby.tsx`) and many code comments still call this step "the pre-join lobby"; the e2e spec is `prejoin.spec.ts`. Read "lobby" as this step only in those places. Everywhere else it means the channel above.
- **Takeover**: joining from a new tab or device ends the user's previous room connection. A user is in at most one room at a time.
- **Admin**: a site-wide role with access to `/admin`, bans, and moderation in any room. A host or mod can't moderate an admin, including one in their reconnect grace or restored after a restart. Admins promote and demote each other from `/admin`.
- **Env admin**: an admin listed in `ADMIN_DISCORD_IDS`. They're granted the role at every sign-in and can't be demoted.
- **Ban**: a site-wide block an admin puts on a user, with a reason and an optional expiry. It signs them out and removes them from any live room at once. Admins can't be banned.
- **Audit log**: the record of every admin action (who, what, on whom or which room, when). It is kept indefinitely.
- **Feed**: the running list of what happens in a room (who joined, left, started or stopped sharing), shown live to the people in it and not kept after the room ends.
- **Room timeline**: the admin-only record of everything that happened in a room, kept 90 days to diagnose problems: presence and reconnects, takeovers, moderation and knocks, shares, cameras and mics, each pair's connection, refused messages and problem reports. Unlike the feed, people in the room never see it.
- **Server log**: what the server writes about what it refused, dropped or failed at, and about its sockets, kept 90 days and searched by room or user by an admin. It never holds IP addresses, chat, tokens or session ids. It is not the **room timeline**, which belongs to one room, though each timeline event is also written to it.
- **Problem report**: a moment someone in a room flags as going wrong (a blurry or frozen stream, no audio, can't connect), with an optional note. Only admins see it, on the room timeline, together with a snapshot of how everyone's connections looked at that moment.
- **Quality sample**: a measurement of how well one person's video reached another (or left them), taken in every room so an admin can tell why one viewer saw a blurry or stuttering share. It names both people and the room, is kept 90 days (longer than the room's own recap), and is shown only to admins.
- **Upload budget**: the most a streamer's connection is measured to send across all their viewers, each of whom is entitled to a fair share (`UplinkBudget` in code; ADR 2).

## Stack at a glance
TanStack Start (React 19, Vite) · Tailwind v4 + Base UI · WebSocket signalling in the same Node process · native WebRTC full mesh · STUN + Cloudflare TURN · Better Auth (Discord) · Postgres + Drizzle · Docker Compose on the homelab behind Cloudflare Tunnel · pnpm, Biome, Vitest, Playwright.
