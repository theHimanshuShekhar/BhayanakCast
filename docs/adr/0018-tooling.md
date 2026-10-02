# 18. Tooling

Date: 2026-09-27 · Status: accepted

## Decision
- pnpm, with TypeScript in strict mode.
- Biome for lint and format.
- Vitest for unit/integration tests: room state machine, signalling handlers, stats roll-ups against a real Postgres.
- Playwright for end-to-end tests on Chromium and Firefox, using fake media devices (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`) and multiple browser contexts to simulate peers.

## Addendum: CI (2026-09-27)
GitHub Actions runs Biome, typecheck and Vitest on every push and PR. The Playwright suite (Chromium + Firefox, including multi-peer fake-media tests) runs nightly.

## Addendum: reliable tests and real-Postgres coverage (2026-10-02, #82)
- **Boot in hooks.** A test that boots PGlite (`createTestDb`, `startRealtimeHarness`) does it in `beforeEach`, never in the `it` body: only a hook gets `hookTimeout` (30 s), where the test's budget is `testTimeout`. Per-test harness options are a `describe` with its own `beforeEach`.
- **Waits are real-time guards, generous.** The harness's `waitFor` and `settled` give up after 10 s (was 2 s) and `expect.poll` after 10 s (was 1 s). They only run out in a failing test, and they count real time, not the fake clock, so tests stay deterministic. `testTimeout` is 30 s so a test outlasts one such wait and fails with what it waited for.
- **Nightly flakes are visible.** The nightly run reports tests that failed and then passed on a retry: a warning annotation, a job summary naming each one, and the HTML report and `test-results` uploaded for them as for a failure. Traces are `retain-on-failure-and-retries`, so the failed attempt's trace is kept (`on-first-retry` kept only the passing retry's). A flake does not turn the run red: retries stay a safety net, and the summary is the record. To fail on one, set Playwright's `failOnFlakyTests`.
- **The production server's wiring is tested.** `createProdServer` (src/server/prod-server.ts) holds what `server.prod.ts` used to wire inline (srvx, the `cf-connecting-ip` rewrite, the realtime endpoint); its test starts it and reads the client IP an app handler sees.
- **Real Postgres through postgres-js.** `pnpm test:migrate` also runs `src/db/postgres.docker.test.ts`: a database seeded at an older migration (before the public-stats columns), migrated to head, then read through the production driver (`createDb`) with the real queries (profiles, search, roll-up, purge, rooms, thumbnails, settings). The container helper is src/db/docker-postgres.ts, shared with the migration runner tests.
