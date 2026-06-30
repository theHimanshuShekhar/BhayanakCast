# Implementation Plan

Build vertical slices, not disconnected subsystems.

## Slice order

1. App foundation: TanStack Start, Tailwind v4, shadcn/ui setup, Docker Compose, Postgres, Valkey, Drizzle migrations on startup, config contract, structured logs.
2. Auth/account slice: Better Auth Discord provider, static admin allowlist, test-only auth bypass, authenticated app shell.
3. Room basics slice: create room, public/private discovery, password gate, room lifecycle states, membership history, host assignment.
4. Realtime room slice: Socket.IO same-port server, room join validation, presence, chat validate/persist/broadcast, discovery room updates, reconnect grace.
5. Moderation slice: host stop/ban/clear ban, reports, platform sanctions, admin dashboard operations.
6. Stream slice: Chromium start-stream gate, stream sessions, local preview tile, preview thumbnail upload, watch/unwatch P2P signaling, retry/failure UI.
7. Aggregation/profile slice: nightly user facts, user-pair facts, public profiles, admin metrics with last-updated timestamp.
8. Final polish: visual fidelity to `docs/design/prototype/`, subtle motion, accessibility pass, Playwright Chromium e2e coverage.

Each slice must include its own Zod validation, Vitest coverage for non-trivial logic, and docs updates when behavior diverges from this plan.

Development and automated tests may use deterministic seed users, rooms, memberships, streams, messages, reports, sanctions, and aggregate facts. Production must not load demo seed data.
