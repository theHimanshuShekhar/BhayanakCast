# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small friend groups, usually Discord-centric crews, hanging out together online: playing and watching games, movie nights, co-watching, or roasting someone's slide deck or broken build. They sign in with Discord and want to be watching each other's screens in seconds, without downloads, expiring meeting links, or "can you see my screen?".

Secondary audiences, confirmed by the codebase:
- **Visitors** (not signed in) browse home, profiles, and recaps, and must sign in to enter a room.
- **Hosts and mods** run their room: rename it, stop a share, remove people, approve knocks.
- **Admins** moderate site-wide from `/admin`: bans, ending rooms, and the audit log.

## Product Purpose

BhayanakCast is live screen sharing for small groups. Anyone opens a room, brings friends, and up to 3 people share their screens at once to up to 10 people. Success means a hangout that starts with no friction, looks sharp, and leaves a record people want to come back to (recaps, stats, co-time).

## Positioning

A multi-screen hangout room. Up to 3 people can share at the same time, so nobody takes turns. Streams go browser to browser (P2P mesh) with no downloads. Recaps, lifetime stats, co-time, and favorites turn hangouts into shared social memory. Discord Go Live, Zoom, and Twitch can't truthfully claim this combination.

## Operating Context

- Entry: "Sign in with Discord" goes straight to OAuth. There is no sign-in page.
- Flow: home (live rooms with thumbnail mosaics) → pre-join lobby (mic and camera start **off**) → room (streams, cameras, chat, per-stream volume) → recap after the room ends.
- Rooms are public, or private with an invite link where joiners **knock**. A user is in at most one room at a time (takeover).
- Production: https://cast.bhayanak.net. Domain terms are defined in `CONTEXT.md`, and decisions are in `docs/adr/`.

## Capabilities and Constraints

- Room cap of 10 people and 3 concurrent streamers. Up to 1080p60 with adaptive quality. Share audio, mic, and camera are supported.
- Room lifecycle: live → idle (up to 5 min) → ended. Recaps are kept for 30 days. Stats and co-time persist forever.
- Browsers: desktop Chrome, Edge, and Firefox are fully supported. Safari is best-effort. On mobile, people can watch, chat, use their mic, and turn on their camera. Screen sharing is unavailable there and the share control is hidden (ADR 17).
- Appearance (theme, accent hue, radius, density, layout, chat panel) is a per-user setting stored on the user row (ADR 13).
- Stack: TanStack Start (React 19), Tailwind v4 with Base UI primitives, JetBrains Mono, a hand-rolled icon set, and custom SVG charts.

## Brand Commitments

- **The UI source of truth is the claude.ai/design project `BhayanakCast.html`** (ADR 13). Ports keep the visual result identical to the design. Documented behavioural deviations are recorded as ADR addenda.
- **Voice:** playful, casual, and irreverent, aimed at friends rather than meetings. Examples from the README: "Your crew. Your screens. One room.", "remove someone who's ruining the vibe", "a slide deck you want roasted before Monday".
- Name: BhayanakCast. Identity comes from Discord (avatars and usernames).

## Evidence on Hand

- Product screenshots: `docs/screenshots/` (room, home, recap, profile, mobile-home, mobile-room).
- Design prototype: `docs/design/prototype/`.
- Absent: testimonials, user counts, press, and benchmarks. Do not fabricate them.

## Product Principles

1. **Zero friction to hanging out.** Get from a Discord sign-in to watching screens in as few steps as possible. No downloads, no link juggling.
2. **Screens together, not in turns.** Concurrent sharing is the core, and layouts should make several streams feel natural.
3. **Never go live by accident.** Mic, camera, and share are off until the user chooses them.
4. **Hosts own their room.** Give moderation power to the people running the hangout, and keep private rooms truly private.
5. **Hangouts leave a memory.** Recaps, stats, and co-time are part of the product, not an afterthought.
