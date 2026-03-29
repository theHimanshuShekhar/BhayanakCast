# Testing Guide

## Test Framework

- **Runner:** Vitest v3, single-threaded (no parallel file execution — avoids DB conflicts)
- **Environment:** jsdom for component tests
- **Coverage:** v8 provider, 90% threshold enforced
- **E2E:** Playwright (run locally only — not in CI)

## Running Tests

```bash
pnpm test:unit          # All Vitest tests (373 passing)
pnpm test:watch         # Watch mode
pnpm test:coverage      # Coverage report

# Run a single file
node_modules/.bin/vitest run tests/unit/path/to/test.ts

# E2E (requires dev server running)
pnpm dev                # Terminal 1
pnpm test:e2e           # Terminal 2
```

## Test Summary

| Category | Count | Notes |
|----------|-------|-------|
| Unit tests | ~250 | Pure logic + components |
| Integration tests (active) | ~120 | DB queries, WebSocket rate limiting |
| Integration tests (skipped) | 16 | TanStack Start server fn limitation |
| **Total (Vitest)** | **373 passing** | |
| E2E (Playwright) | 23 | Run locally, not in CI |

### Skipped Tests

`tests/integration/rate-limiting.test.ts` (16 tests) — TanStack Start `createServerFn` cannot be called in Vitest (requires full Hono runtime + Vite build context). Alternative coverage: 35 rate-limiter unit tests + 27 WebSocket rate-limiting tests + E2E tests.

## Test Structure

```
tests/
├── unit/
│   ├── rate-limiter.test.ts          # 35 tests
│   ├── profanity-filter.test.ts      # 34 tests
│   ├── room-state.test.ts
│   ├── connection-retry.test.ts
│   ├── participant-types.test.ts
│   ├── hooks/
│   │   └── use-room-peerid.test.ts   # streamerPeerId handling
│   ├── lib/
│   │   └── peerjs-context.test.tsx   # PeerJS singleton
│   ├── components/
│   │   ├── streaming-error-boundary.test.tsx
│   │   ├── transfer-overlay.test.tsx
│   │   └── video-display-status.test.tsx
│   ├── webrtc/
│   │   ├── device-detection.test.ts  # 16 tests
│   │   └── components.test.tsx       # 18 tests
│   ├── types/
│   │   └── streaming-errors.test.ts
│   └── websocket/
│       └── chat-security.test.ts
│
├── integration/
│   ├── room-management.test.ts       # DB queries
│   ├── user-stats.test.ts
│   ├── room-list.test.tsx
│   ├── websocket-rate-limiting.test.ts      # 25 tests
│   ├── websocket-rate-limiting-simple.test.ts
│   ├── webrtc/
│   │   └── mobile-restrictions.test.ts
│   └── rate-limiting.test.ts         # 16 SKIPPED (see above)
│
└── fixtures/
    ├── users.ts       # Alice, Bob, Carol
    ├── rooms.ts
    ├── participants.ts
    └── relationships.ts
```

## PeerJS Mocking

Use `vi.hoisted()` so the mock instance is available before `vi.mock()` factory runs:

```typescript
const { MockPeer } = vi.hoisted(() => {
  const MockPeer = vi.fn(() => ({
    id: "test-peer-id",
    destroyed: false,
    destroy: vi.fn(),
    on: vi.fn(),
    call: vi.fn(),
  }));
  return { MockPeer };
});
vi.mock("peerjs", () => ({ default: MockPeer }));
```

## MediaStream Stub

jsdom doesn't implement `MediaStream`. Add at the top of video/streaming tests:
```typescript
if (typeof MediaStream === "undefined") {
  (globalThis as Record<string, unknown>).MediaStream = class {
    getTracks() { return []; }
  };
}
```

## Common Patterns

### Mock WebSocket
```typescript
const mockSocket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
vi.mock("#/lib/websocket-context", () => ({
  useWebSocket: () => ({ socket: mockSocket, isConnected: true }),
}));
```

### Mock Auth
```typescript
vi.mock("#/lib/auth-guard", () => ({
  getSessionOnServer: vi.fn(() => Promise.resolve({ user: { id: "test-user-id" } })),
}));
```

### Test Database
Tests use isolated `bhayanak_cast_test` database (auto-created). Each test gets clean state:
```typescript
beforeEach(async () => {
  await clearTables();
  rateLimiter.resetAll();
});
```

## E2E Tests

23 Playwright tests across 4 suites: Room Management, Screen Sharing, Streamer Transfer, Chat.

**Auth:** Tests use email/password auth enabled only in `NODE_ENV=test` via `/api/test/auth/signup`.

**Critical patterns:**
- Always login via UI (not cookie injection)
- Set viewport AFTER login (setting before breaks auth forms)
- Use flexible regex for viewer counts (WS sync delay)

```typescript
test("example", async ({ page, signupTestUser }) => {
  const user = await signupTestUser("Test User");
  await page.goto("/auth/sign-in");
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', "testpassword123");
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3000/");
  await page.setViewportSize({ width: 1200, height: 800 }); // AFTER login
});
```

## See Also
- [Integration Test Limitations](./INTEGRATION_TEST_LIMITATIONS.md)
- [Coding Standards](./CODING_STANDARDS.md)
