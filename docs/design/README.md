# Design Reference

The extracted design package lives in [`prototype/`](./prototype/). Treat it as a visual/product reference, not the implementation source of truth.

Prototype images and uploaded references are reference-only. Do not ship them as product assets.

## Contents

- [`prototype/BhayanakCast.html`](./prototype/BhayanakCast.html) — static browser prototype shell.
- [`prototype/*.jsx`](./prototype/) — React/Babel prototype components and mock seed data.
- [`prototype/app.css`](./prototype/app.css) — prototype styling and design tokens.
- [`prototype/screenshots/`](./prototype/screenshots/) — captured home screenshots.
- [`prototype/uploads/`](./prototype/uploads/) and `prototype/*room*.jpg` — Discord/reference room imagery and generated room mockups.

## What the prototype establishes

- Dense dark-mode, mono-font visual direction.
- Narrow left rail navigation.
- Public Active Rooms discovery surface with live and past room cards.
- Central room mosaic as the primary stream interaction surface.
- Right-side room panel for chat, people, and activity feed.
- User profile page with public social/activity stats.
- Admin dashboard visual direction for metrics and operational views.
- Subtle motion language: active glows, hover lift, panel/menu transitions, live indicators, and tile state changes should feel polished without becoming distracting.

## Canonical product deltas

The prototype predates several product decisions. These deltas are intentional:

- Rooms are not a single “broadcast.” Any room member may start a stream; the host owns/moderates the room.
- V1 has no shared voice and no microphone capture. Streams carry captured screen/application video plus captured stream audio when the browser provides it.
- Room capacity is a hard 10 members because media is peer-to-peer.
- Private rooms are still publicly listed, but require a shared password and hide participant identities on cards.
- Past Streams are room-history records, not replayable recordings.
- Stream previews use server-sent blurred thumbnails every two minutes; subscribing to a stream is still explicit.
- The mockup’s `mod` role is not a v1 room role. V1 room authority is Host; platform-level authority is Platform Admin.
- Profile/admin stats come from nightly aggregates and must show a last-updated timestamp.
- Admin UI must include operational moderation, not only analytics.

## ADR coverage

No additional ADR is needed just for moving or preserving the design assets. The important hard-to-reverse decisions raised by the prototype are already captured:

- [`0001-peer-to-peer-media.md`](../adr/0001-peer-to-peer-media.md) — P2P media, thumbnails, report snapshots, room cap.
- [`0002-auth-and-orm.md`](../adr/0002-auth-and-orm.md) — Better Auth, Discord-only sign-in, Drizzle, admin allowlist, password hashes, startup migrations.
- [`0003-socket-io-room-signaling.md`](../adr/0003-socket-io-room-signaling.md) — Socket.IO rooms as realtime/signaling boundary.
- [`0004-validation-and-testing.md`](../adr/0004-validation-and-testing.md) — Zod, Vitest, Playwright.
- [`0005-single-origin-start-and-socket-io.md`](../adr/0005-single-origin-start-and-socket-io.md) — TanStack Start + Socket.IO on one public port, Node + pnpm, Docker Compose/Postgres boundary.
- [`0006-v1-data-model.md`](../adr/0006-v1-data-model.md) — room lifecycle, memberships, stream sessions, transcripts, reports, sanctions, aggregates.
- [`0007-realtime-protocol.md`](../adr/0007-realtime-protocol.md) — Socket.IO event semantics, join gates, WebRTC signaling, reconnect, thumbnails, chat, host controls.
- [`0008-v1-ui-flows.md`](../adr/0008-v1-ui-flows.md) — v1 UI semantics derived from the design.
- [`0009-ui-implementation-stack.md`](../adr/0009-ui-implementation-stack.md) — Tailwind v4, shadcn/ui, visual fidelity, motion policy, TanStack library usage, and TanStack Pacer boundaries.

## Implementation guidance

Use the prototype for layout, visual rhythm, motion language, and interaction inspiration. Use `CONTEXT.md` and the ADRs for product semantics, data ownership, protocol behavior, and implementation constraints.
