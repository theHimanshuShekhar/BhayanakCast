# Production Audit Findings Implementation Plan

> REQUIRED SUB-SKILL: Use executing-plans skill implement task-by-task.

Goal: close `AUDIT.md` findings in priority order with one tested commit per fixed audit point, then merge each commit back to `main`.

Architecture: fix the smallest production-impacting point first. Prefer backend correctness and user-visible wiring before broad infrastructure. Each task follows TDD: write a failing focused test, run it red, implement the minimum code, run the focused test green, then commit and merge that single point to `main`.

Tech stack: TanStack Start, React, Socket.IO, Drizzle/PostgreSQL, Better Auth, Valkey-compatible rate limiting, Vitest, Playwright.

---

## Priority order

1. Empty-room grace expiry to ended/past stream.
2. Room create validation consistency: enforce 3-character room names at server-action boundary.
3. Production dependency health checks for PostgreSQL and Valkey.
4. Docker production boundary: stop exposing PostgreSQL/Valkey host ports by default.
5. Discovery live updates on the home page.
6. Aggregate recomputation execution path.
7. Admin dashboard operational shell: tabs and live admin join.
8. Admin report resolution UI.
9. Admin sanction create/lift UI.
10. Admin live-room end controls.
11. Room chat send/listen UI.
12. Room leave flow wired to `room:leave`.
13. Room member/mosaic canonical state rendering.
14. Host moderation controls: stop stream, ban, clear ban.
15. Report dialogs for stream/member/chat targets.
16. Duplicate active room client warning/takeover.
17. Reconnect grace semantics.
18. Playwright coverage for completed critical flows.
19. Valkey command connection pooling or client replacement.
20. Production env validation hardening.
21. Observability event coverage.
22. UI token cleanup for hard-coded design values.
23. Home card data cleanup: capacity/duration/privacy/tag projection.
24. Profile room history.
25. Accessibility and reduced-motion tests.
26. Horizontal scale design/adapter implementation.
27. Active thumbnail durability decision/implementation.
28. Backup/restore/retention/deletion operational documentation and hooks.

---

## Task 1: Empty-room grace expiry

Files:
- Modify: `src/lib/rooms.ts`
- Test: `src/lib/rooms.test.ts`

Steps:
1. Add a failing Vitest test that creates a room, leaves it empty, calls a new expiry function with a timestamp after five minutes, and expects the room state to become `ended` with `endedAt` set.
2. Run `pnpm test src/lib/rooms.test.ts -- --runInBand` or the nearest supported focused Vitest command and verify the new test fails because no expiry function exists.
3. Implement `expireEmptyGraceRooms(now = new Date())` in `src/lib/rooms.ts`. It should update rooms where `state = 'empty_grace'` and `empty_since <= now - 5 minutes`, setting `state = 'ended'`, `endedAt = now`, and `updatedAt = now`. Return expired rooms.
4. Run the focused rooms test green.
5. Commit: `fix: expire empty grace rooms`.
6. Merge the commit back to `main`.

## Task 2: Create-room name validation consistency

Files:
- Modify: `src/lib/room-actions.ts`
- Test: `src/routes/-index-create-room-dialog.test.tsx` or `src/lib/rooms.test.ts` if server-action tests already cover create input.

Steps:
1. Add a failing test proving a 1-2 character room name is rejected before calling room creation.
2. Run focused test and verify red.
3. Change `createRoomSchema.name` from `min(1)` to `min(3)`.
4. Run focused test green.
5. Commit: `fix: enforce room name length in action`.
6. Merge back to `main`.

## Task 3: Dependency health checks

Files:
- Modify: `src/lib/health.ts`
- Modify: `src/routes/api/health.ts`
- Test: `src/lib/health.test.ts`

Steps:
1. Add failing tests for an async health function that reports `database: ok|error` and `valkey: ok|skipped|error` using injected check functions.
2. Run focused health tests red.
3. Implement `createHealthPayload` as async dependency-aware function with injectable checks. Keep route behavior simple: await it and return JSON.
4. Run focused tests green.
5. Commit: `fix: check health dependencies`.
6. Merge back to `main`.

## Task 4: Docker private dependency boundary

Files:
- Modify: `docker-compose.yml`
- Test: existing docs/config tests if present, otherwise add a minimal config/static test that parses compose text.

Steps:
1. Add failing test asserting `postgres` and `valkey` services do not expose host `ports` in the default compose file.
2. Run focused test red.
3. Remove `ports` from `postgres` and `valkey`. If local host access is still needed, document override-only use later; do not add new abstractions now.
4. Run focused test green.
5. Commit: `fix: keep backing services internal`.
6. Merge back to `main`.

## Task 5: Discovery live updates

Files:
- Modify: `src/routes/index.tsx`
- Test: `src/routes/-index.test.ts`

Steps:
1. Add failing test that the home page source/runtime includes `discovery:join` and handlers for `discovery:roomCreated`, `discovery:roomUpdated`, `discovery:roomRevived`, and `discovery:roomEnded`.
2. Run focused route test red.
3. Add a small `useEffect` in home to connect Socket.IO when authenticated, join discovery, update local room state on broadcasts, and leave/disconnect on cleanup.
4. Run focused test green.
5. Commit: `feat: live update discovery rooms`.
6. Merge back to `main`.

## Task 6: Aggregate recomputation execution path

Files:
- Create: `scripts/recompute-daily-facts.mjs`
- Modify: `package.json`
- Test: package/script test or lightweight script existence test.

Steps:
1. Add failing test asserting `package.json` has a script for recomputing daily facts and the target script exists.
2. Run red.
3. Add `facts:recompute` script that runs a small Node/tsx script calling `recomputeDailyFacts(day)` for an explicit day or yesterday by default.
4. Run green.
5. Commit: `feat: add aggregate recompute script`.
6. Merge back to `main`.

## Remaining tasks

Tasks 7-28 follow the same cadence: one failing test, one minimal implementation, focused tests, one commit, merge back to `main`. Do not start a later task if an earlier merge is blocked.
