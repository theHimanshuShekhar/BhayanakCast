# Zod, Vitest, and Playwright

BhayanakCast will use Zod for runtime validation and inferred TypeScript types at trust boundaries, Vitest for unit and integration tests, and Playwright for browser end-to-end tests. Zod's `parse`/`safeParse` model fits Socket.IO payloads, HTTP requests, and form submissions; Vitest supports TypeScript/jsdom test configuration; Playwright can launch the app with `webServer` and run browser assertions against real user flows.

Implementation is not shippable until Vitest unit tests cover pure/domain/Zod logic, Vitest integration tests cover PostgreSQL-backed data flows and Socket.IO protocol behavior, and Playwright Chromium end-to-end tests cover auth-gated app flows, public/private room join, room lifecycle, and stream UI states. Firefox/Safari watch compatibility is not part of the blocking e2e matrix for v1 because stream creation is Chromium-only.

Automated tests use a test-only auth bypass to create real signed-in sessions for seeded Better Auth users. The bypass must be gated to the test runtime and unavailable in development and production; Playwright must not automate real Discord OAuth.
