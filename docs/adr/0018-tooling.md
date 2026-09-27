# 18. Tooling

Date: 2026-09-27 · Status: accepted

## Decision
- pnpm, with TypeScript in strict mode.
- Biome for lint and format.
- Vitest for unit/integration tests: room state machine, signalling handlers, stats roll-ups against a real Postgres.
- Playwright for end-to-end tests on Chromium and Firefox, using fake media devices (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`) and multiple browser contexts to simulate peers.
