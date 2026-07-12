# Home and Room Route Design

**Date:** 2026-07-12  
**Status:** Validated  
**Scope:** `/` and `/rooms/:roomId`, plus the real `/users/:userId` and `/profile` destinations required by complete Home navigation

## Goal

Implement the Home and Room routes that carry BhayanakCast's core journey while preserving the accepted URL, domain, design, realtime, media, accessibility, and testing contracts. Home is completed first. That phase adds only the thin real Room boundary required for room-card navigation/OAuth/admission/creator entry and the public/private profile destinations required for working search results and account navigation. The full admitted Room workspace follows in the final linked plan.

## Source of truth

`CONTEXT.md` and accepted ADRs are authoritative. The primary route decisions are:

- URL contract: ADR 0029
- Home: ADRs 0079–0099
- Room admission/lifecycle/media: ADRs 0059–0078 and 0100–0104
- Stack: ADR 0105
- Testing and qualification: ADR 0106
- Visual system: `DESIGN.md` and ADR 0096

## Route architecture

Use TanStack Start file routes:

- `src/routes/__root.tsx` — HTML document, metadata defaults, theme bootstrap, session/Query context, global error and not-found boundaries, and `<Outlet />`
- `src/routes/index.tsx` — `/`
- `src/routes/rooms/$roomId.tsx` — `/rooms/:roomId`
- `src/routes/users/$userId.tsx` — thin public-profile destination required by Home search
- `src/routes/profile.tsx` — authenticated current-Account destination required by Home navigation

Route modules validate URL input, define loader work, select the route projection, and compose feature components. Database queries, policy, Socket.IO handlers, and large component trees do not live in route modules.

Keep route-specific implementation under:

- `src/features/home/`
- `src/features/room/`
- `src/features/public-profile/` — bounded public-profile destination required by Home
- `src/features/profile/` — private current-Account activity, preferences, and deletion request

Keep server-only auth, persistence, policy, lifecycle, and realtime composition under `src/server/`. Keep capture tracks and `RTCPeerConnection` under the Room browser feature. Extract a shared component only after both routes need the same accessible behavior; do not prebuild a component library.

## Styling

Use exact-pinned Tailwind CSS v4 through `@tailwindcss/postcss`. Configure the committed Source Sans 3 type scale, porcelain/midnight themes, semantic colors, 4px spacing family, 8/12px radii, 768/1280px structural breakpoints, z-index scale, and 120/180/240ms motion in CSS-first `@theme` tokens. Select dark mode with `data-theme="dark"` and retain device preference as the initial value plus a persisted user override.

Tailwind is styling infrastructure only. Do not add a Tailwind component library, animation library, class-merging helper, variant factory, CSS-in-JS layer, or a second token source. Use native elements and platform APIs where they satisfy the behavior. Accessibility and security are not simplified away.

## Home route

`/` owns one canonical search model:

- normalized `q`
- optional normalized `category`
- sorted, normalized, deduplicated `tags`

The route loader blocks on the visible discovery/search projection and ten Past Streams. Facets, statistics, and connected presence prefetch independently. TanStack Query is the only Home domain fetching/cache boundary; Better Auth owns session state separately.

The center has two mutually exclusive projections:

1. Normal discovery: search/filter controls, stable ranked Live Rooms, and ten Past Streams.
2. Query results: uniform Active Room and Public Profile groups; filters affect rooms only.

Wide, medium, and small layouts reuse one semantic content tree. CSS changes placement and visibility while preserving meaningful DOM order. The featured/list assignment is frozen from the canonical snapshot; live value patches do not reorder it. Membership-changing events invalidate affected queries. Successful realtime reconnect refetches active keys and recomputes ranking once.

Create Room is one form with modal presentation on wide/medium and full-screen presentation on small. Anonymous activation carries only an opaque create intent through Discord OAuth and returns to a blank form. Authenticated creation validates target-first membership switching, creates canonical room state, enters the creator as Host, and navigates to the real Room boundary.

## Room route

`/rooms/:roomId` is one stable, `noindex` URL with four server-derived projections:

1. Missing: generic not-found behavior without leaked room data.
2. Live pre-admission: public metadata plus privacy, Full, authentication, private-password, and explicit Join behavior.
3. Admitted live: membership-authorized room workspace.
4. Past Stream: public metadata/end summary without Join, replay, media controls, or public transcript.

Chat, People, Activity, Settings, Stream, and watch state remain on this route rather than becoming nested routes. Forced departure replaces admitted state with pre-admission in place. Lifetime or Platform Admin end replaces it with the Past Stream projection in place.

The admitted workspace uses one state model with three presentations:

- Wide: 72px app rail, two-line header, dark media canvas, bottom control shelf, persistent 360px companion dock.
- Medium: app rail plus non-modal right companion drawer that neither pauses media nor reflows the mosaic.
- Small: compact header, contextual room bar, primary watched stage, horizontal remaining-member strip, and 55%/90% companion sheets.

Server canonical state owns admission, membership, Host, capacity, chat, moderation, Streams, subscriptions, lifecycle, and signaling authorization. Browser state owns capture tracks, peer connections, mute/fullscreen, local draft/scroll state, and the viewer-local non-streamer visibility preference. Socket.IO transports canonical events and WebRTC signaling metadata, never media.

## Failure and recovery

Every asynchronous boundary exposes a named state. Home distinguishes loading, placeholder refresh, empty, failed, stale/reconnecting, and canonical success. Room distinguishes admission failure, Full, invalid private password, chat-only compatibility, capture denial, Stream startup failure, watch retry/exhaustion, reconnect grace, displacement, forced departure, and room end.

Errors remain local when authority permits. Media failure preserves membership and chat. Valkey failure blocks mutations whose application rate limit cannot be enforced. PostgreSQL failure rejects durable work. No failure renders missing metrics as zero or invents canonical success.

## Verification

Follow ADR 0106:

- Vitest unit/property/model tests: normalization, ranking, validation, projection selection, and pure state transitions.
- Production-shaped Vitest integration: real Node, PostgreSQL, Valkey, Better Auth, and Socket.IO with worker-isolated state and a controlled application clock.
- Playwright: representative multi-user browser journeys with separate contexts, real local signaling/WebRTC, synthetic media, accessibility checks, and selective visual baselines.
- Capacity, real-device/network ICE, public-origin, Discord, dependency recovery, backup, and restore remain separate release qualifications.

Accessibility is implemented with each surface: semantic card links, native labels, focus management, keyboard operation, polite announcements, safe areas, reduced motion, and checked contrast. It is never deferred to a cleanup phase.

## Linked implementation plans

1. [`2026-07-12-home-route-implementation.md`](./2026-07-12-home-route-implementation.md) — build the foundation and complete Home plus the thin real Room/public-profile boundaries.
2. [`2026-07-12-profile-route-prerequisite.md`](./2026-07-12-profile-route-prerequisite.md) — after Home Tasks 1–9, complete the signed-in Profile destination before resuming Home Task 10.
3. [`2026-07-12-room-route-implementation.md`](./2026-07-12-room-route-implementation.md) — deepen the Room route into the complete admitted workspace and recovery behavior.
