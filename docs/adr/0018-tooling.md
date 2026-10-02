# 18. Tooling

Date: 2026-09-27 · Status: accepted

## Decision
- pnpm, with TypeScript in strict mode.
- Biome for lint and format.
- Vitest for unit/integration tests: room state machine, signalling handlers, stats roll-ups against a real Postgres.
- Playwright for end-to-end tests on Chromium and Firefox, using fake media devices (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`) and multiple browser contexts to simulate peers.

## Addendum: CI (2026-09-27)
GitHub Actions runs Biome, typecheck and Vitest on every push and PR. The Playwright suite (Chromium + Firefox, including multi-peer fake-media tests) runs nightly.

## Addendum: CI runs once per change, and checks migrations (2026-10-02)
- The CI workflow runs on pushes to `main` and on pull requests, not on every push: a PR branch used to get a run for the push and another for the PR.
- A **drift step** runs `drizzle-kit check` (the migration history is consistent) and `drizzle-kit generate` (it fails if the schema in `src/db/schema` has changes with no migration, because generating would add files under `drizzle/`). The migrations themselves are applied by every database test (`createTestDb` runs them on PGlite).
- Dependabot also opens weekly PRs for npm (minor and patch together, majors alone, `@types/node` majors left to the Node bump) and for GitHub Actions, next to the container image entries (ADR 9, docs/deploy.md "Pinned images").
