# Testing Guide

Complete guide to testing BhayanakCast.

## Test Framework

- **Runner:** Vitest v3
- **Environment:** jsdom (for component tests)
- **Assertions:** Vitest built-in + @testing-library/jest-dom
- **Coverage:** v8 provider with 90% threshold

## Test Structure

```
tests/
├── unit/                          # Unit tests
│   ├── rate-limiter.test.ts      # Rate limiting logic (35 tests)
│   ├── profanity-filter.test.ts  # Content filtering (34 tests)
│   ├── RoomCard.test.tsx         # Component tests (8 tests)
│   ├── CreateRoomModal.test.tsx  # (6 tests)
│   ├── CommunityStatsCard.test.tsx # (6 tests)
│   └── webrtc/                   # WebRTC streaming tests (47 tests)
│       ├── device-detection.test.ts      # 16 tests
│       ├── useWebRTC.test.ts             # 13 tests
│       └── components.test.tsx           # 18 tests
│
├── integration/                  # Integration tests
│   ├── room-management.test.ts   # DB queries (15 tests) ✅
│   ├── user-stats.test.ts        # Stats queries (14 tests) ✅
│   ├── room-list.test.tsx        # Component + DB (10 tests) ✅
│   ├── rate-limiting.test.ts     # ⏭️ 16 SKIPPED (needs server context)
│   ├── rooms.test.ts             # ⏭️ 20 SKIPPED (needs server context)
│   ├── websocket-rate-limiting.test.ts  # WS rate limiting (25 tests) ✅
│   └── webrtc/                   # WebRTC integration tests
│       ├── websocket-signaling.test.ts   # ⏭️ 2 SKIPPED
│       ├── mobile-restrictions.test.ts   # (2 tests) ✅
│       └── streamer-transfer.test.ts     # (0 tests)
│
├── fixtures/                     # Test data
│   ├── users.ts                 # 3 test users
│   ├── rooms.ts                 # 5 test rooms
│   ├── participants.ts          # Participation records
│   └── relationships.ts         # User relationships
│
└── utils/                        # Test utilities
    ├── database.ts              # Test DB connection
    ├── render.tsx               # React Query wrapper
    └── mocks.ts                 # Mock utilities

e2e/                             # E2E tests (Playwright)
├── fixtures/
│   └── streaming.ts             # E2E test helpers
├── tests/
│   ├── room-management.spec.ts  # 6 tests ✅
│   ├── screen-sharing.spec.ts   # 6 tests ✅
│   ├── streamer-transfer.spec.ts # 4 tests ✅
│   └── chat.spec.ts             # 7 tests ✅
└── README.md
```

## Test Summary

| Category | Count | Status |
|----------|-------|--------|
| **Unit Tests** | 204 | ✅ All passing |
| **Integration Tests** | 66 active, 38 skipped | ✅ Active passing |
| **E2E Tests** | 23 | ✅ All passing |
| **Total** | **265** (204 + 23 E2E) | ✅ Comprehensive coverage |

## WebRTC Test Summary

**Total WebRTC Tests: 47 unit + 16 E2E = 63 tests**

### Unit Tests (47 tests)
- **device-detection.test.ts (16 tests)** - Mobile/desktop detection
- **useWebRTC.test.ts (13 tests)** - Screen sharing and transfer handling
- **components.test.tsx (18 tests)** - UI components and interactions

### E2E Tests (16 tests)
Located in `e2e/tests/`:
- **screen-sharing.spec.ts (6 tests)** - Screen sharing flows
- **streamer-transfer.spec.ts (4 tests)** - Streamer transfer with reconnection
- **room-management.spec.ts (6 tests)** - Room lifecycle
- **chat.spec.ts (7 tests)** - Chat functionality

### Skipped WebRTC Tests (2 tests)
- **websocket-signaling.test.ts (2 tests)** - Requires full WebSocket server infrastructure
  - See [Integration Test Limitations](./INTEGRATION_TEST_LIMITATIONS.md) for details
tests/
├── unit/                          # Unit tests
│   ├── rate-limiter.test.ts      # Rate limiting logic (35 tests)
│   ├── profanity-filter.test.ts  # Content filtering (49 tests)
│   ├── RoomCard.test.tsx         # Component tests
│   ├── CreateRoomModal.test.tsx
│   ├── CommunityStatsCard.test.tsx
│   └── webrtc/                   # WebRTC streaming tests (47 tests)
│       ├── device-detection.test.ts      # 16 tests
│       ├── useWebRTC.test.ts             # 13 tests
│       └── components.test.tsx           # 18 tests
│
├── integration/                  # Integration tests
│   ├── room-management.test.ts   # DB queries (15 tests)
│   ├── user-stats.test.ts        # Stats queries (14 tests)
│   ├── room-list.test.tsx        # Component + DB
│   ├── rate-limiting.test.ts     # Skipped (needs server context)
│   ├── rooms.test.ts             # Skipped (needs server context)
│   ├── websocket-rate-limiting.test.ts  # WS rate limiting
│   └── webrtc/                   # WebRTC integration tests
│       ├── websocket-signaling.test.ts
│       ├── mobile-restrictions.test.ts
│       └── streamer-transfer.test.ts
│
├── fixtures/                     # Test data
│   ├── users.ts                 # 3 test users
│   ├── rooms.ts                 # 5 test rooms
│   ├── participants.ts          # Participation records
│   └── relationships.ts         # User relationships
│
└── utils/                        # Test utilities
    ├── database.ts              # Test DB connection
    ├── render.tsx               # React Query wrapper
    └── mocks.ts                 # Mock utilities

## WebRTC Test Summary

**Total WebRTC Tests: 47**

### Unit Tests (47 tests)
- **device-detection.test.ts (16 tests)** - Mobile/desktop detection
- **useWebRTC.test.ts (13 tests)** - Screen sharing and transfer handling
- **components.test.tsx (18 tests)** - UI components and interactions

### E2E Tests (Playwright)
Located in `e2e/tests/streaming/`:
- Screen sharing flow
- Viewer joining
- Streamer transfer
- Mobile restrictions
- Audio configuration
```

## Running Tests

### All Tests (265 total: 204 unit/integration + 23 E2E)

```bash
# Run all tests (unit + integration + E2E)
pnpm test

# Note: E2E tests require the dev server to be running on port 3000
pnpm dev  # In another terminal
```

### Unit Tests Only (204 tests)

```bash
pnpm test:unit
```

### E2E Tests Only (23 tests)

```bash
# Requires dev server running
pnpm test:e2e

# E2E tests with UI mode
pnpm test:e2e:ui
```

### WebRTC Tests

```bash
# All WebRTC unit tests (47 tests)
pnpm vitest run tests/unit/webrtc/

# Specific WebRTC test files
pnpm vitest run tests/unit/webrtc/device-detection.test.ts
pnpm vitest run tests/unit/webrtc/useWebRTC.test.ts
pnpm vitest run tests/unit/webrtc/components.test.tsx

# WebRTC E2E tests
pnpm test:e2e e2e/tests/screen-sharing.spec.ts
pnpm test:e2e e2e/tests/streamer-transfer.spec.ts
```

### Specific Test File

```bash
pnpm vitest run tests/unit/rate-limiter.test.ts
```

### Watch Mode

```bash
pnpm test:watch
```

### With Coverage

```bash
pnpm test:coverage
```

### Debug Mode

```bash
pnpm vitest run tests/unit/room-card.test.tsx --reporter=verbose
```

## Test Database

Tests use an isolated PostgreSQL database that is automatically created:

**Database:** `bhayanak_cast_test` (same server as main database)
**Connection:** Derived from DATABASE_URL in `.env.local`
**Auto-creation:** Database is created automatically if it doesn't exist
**Migrations:** Schema is synced automatically using `drizzle-kit push`

### Setup

```bash
# Start PostgreSQL (one-time)
docker compose up -d postgres

# That's it! Tests will auto-create the database and schema
pnpm test
```

### Manual Setup (Optional)

If you prefer manual control:

```bash
# Create test database manually
docker exec bhayanak-postgres createdb -U postgres bhayanak_cast_test

# Push schema
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bhayanak_cast_test" pnpm db:push
```

### Test Isolation

Each test gets a clean database state:

```typescript
// tests/setup.ts
beforeEach(async () => {
  await clearTables();        // Delete all data
  rateLimiter.resetAll();     // Reset rate limits
});
```

## Writing Tests

### Unit Test Example

```typescript
// tests/unit/rate-limiter.test.ts
describe("RateLimiter", () => {
  beforeEach(() => {
    RateLimiter.resetInstance();
  });

  it("allows requests within limit", () => {
    const limiter = RateLimiter.getInstance();
    const result = limiter.check("user1", { 
      windowMs: 60000, 
      maxAttempts: 3 
    });
    
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });
});
```

### Component Test Example

```typescript
// tests/unit/RoomCard.test.tsx
describe("RoomCard", () => {
  it("renders room name", () => {
    render(<RoomCard room={mockRoom} />);
    expect(screen.getByText("Test Room")).toBeInTheDocument();
  });

  it("shows live indicator when streaming", () => {
    render(<RoomCard room={activeRoom} />);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });
});
```

### Integration Test Example

```typescript
// tests/integration/room-management.test.ts
describe("getActiveRooms", () => {
  beforeEach(async () => {
    await clearTables();
    await insertTestUsers(db);
    await insertTestRooms(db);
  });

  it("returns all active rooms", async () => {
    const rooms = await getActiveRooms();
    expect(rooms.length).toBeGreaterThan(0);
    expect(rooms[0].streamer).toBeDefined();
  });
});
```

## Test Fixtures

Use fixtures for consistent test data:

```typescript
// In your test
import { insertTestUsers } from "../fixtures/users";

beforeEach(async () => {
  await clearTables();
  await insertTestUsers(db);
});
```

### Available Fixtures

- **users.ts:** 3 test users (Alice, Bob, Carol)
- **rooms.ts:** 5 test rooms (various states)
- **participants.ts:** Participation records
- **relationships.ts:** User relationship data

## Mocking

### Mock External Modules

```typescript
vi.mock("#/lib/auth-guard", () => ({
  getSessionOnServer: vi.fn(() => 
    Promise.resolve({ user: { id: "test-user-id" } })
  ),
  publicRoute: () => {},
}));
```

### Mock Functions

```typescript
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children }) => <a>{children}</a>,
}));
```

### Mock WebSocket

```typescript
const mockSocket = {
  emit: vi.fn(),
  on: vi.fn(),
  join: vi.fn(),
};

vi.mock("#/lib/websocket-context", () => ({
  useWebSocket: () => ({ socket: mockSocket }),
}));
```

## Coverage Requirements

Minimum thresholds (configured in vitest.config.ts):

```typescript
thresholds: {
  statements: 90,
  branches: 90,
  functions: 90,
  lines: 90,
}
```

### Check Coverage

```bash
pnpm test:coverage
```

Output:
```
 % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
---------|----------|---------|---------|-------------------
  94.12  |   91.23  |  92.45  |  94.56  |
```

## Skipped Tests

**Total: 38 tests skipped** (documented with inline comments and comprehensive documentation)

### Why Tests Are Skipped

Some integration tests cannot run in the Vitest environment due to infrastructure limitations:

### 1. TanStack Start Server Functions (36 tests)

**Files:**
- `tests/integration/rate-limiting.test.ts` (16 tests)
- `tests/integration/rooms.test.ts` (20 tests)

**Reason:** 
TanStack Start server functions (`createServerFn`) require a full TanStack Start runtime context that includes:
- Hono server runtime with proper request/response context
- Vite plugin transformations at build time
- Server function registry setup

When run in vitest, server functions return `undefined` instead of executing.

**Alternatives:**
- ✅ **Unit tests:** 35 tests covering rate limiting algorithm in `tests/unit/rate-limiter.test.ts`
- ✅ **Database tests:** Direct DB query tests in working integration tests
- ✅ **E2E tests:** 23 Playwright tests covering full user flows

**Documentation:**
- Comprehensive header comments in each skipped test file
- Full explanation in [Integration Test Limitations](./INTEGRATION_TEST_LIMITATIONS.md)
- Inline comments on each `describe.skip` block

### 2. WebSocket WebRTC Signaling (2 tests)

**File:** `tests/integration/webrtc/websocket-signaling.test.ts`

**Reason:**
These tests require the full WebSocket server infrastructure with WebRTC event handlers:
- Full Express/HTTP server with Socket.io
- Database connection
- Room manager with all business logic
- Socket authentication middleware

Setting this up in unit tests would essentially require running the full server.

**Alternatives:**
- ✅ **WebRTC hook tests:** 13 tests in `tests/unit/webrtc/useWebRTC.test.ts`
- ✅ **WebRTC component tests:** 18 tests in `tests/unit/webrtc/components.test.tsx`
- ✅ **E2E tests:** 10 Playwright tests covering screen sharing and transfers

**Documentation:**
- Full header comment explaining why tests are skipped
- Reference to [Integration Test Limitations](./INTEGRATION_TEST_LIMITATIONS.md)
- Alternative test coverage clearly documented

### How to Test Skipped Scenarios

#### Option 1: E2E Tests (Recommended)
```bash
# Run E2E tests that cover the same scenarios
pnpm test:e2e  # 23 tests covering room ops, streaming, transfers
```

#### Option 2: Manual Testing
```bash
# Start dev server
pnpm dev

# Manually test:
# 1. Create rooms (test rate limiting by creating 4 quickly)
# 2. Join/leave rooms
# 3. Transfer streamer ownership
# 4. Screen sharing with multiple users
```

#### Option 3: Unit Tests
```bash
# Run unit tests that cover the core logic
pnpm vitest run tests/unit/rate-limiter.test.ts      # 35 tests
pnpm vitest run tests/unit/webrtc/                   # 47 tests
```

### When Will These Tests Be Enabled?

**Short Term:**
- Tests remain skipped until TanStack Start provides testing utilities
- E2E tests provide comprehensive coverage of the same scenarios

**Long Term:**
1. TanStack Start releases official testing support
2. Re-enable server function tests (36 tests)
3. Consider WebSocket test server for signaling tests (2 tests)
4. Achieve 90%+ coverage across all layers

### Current Coverage Despite Skipped Tests

Even with 38 skipped tests, the codebase has excellent coverage:

- **204 unit tests** covering core logic and components
- **66 active integration tests** covering database queries
- **23 E2E tests** covering critical user flows in real browsers
- **90%+ code coverage** threshold maintained

See [Integration Test Limitations](./INTEGRATION_TEST_LIMITATIONS.md) for complete details.

## Common Issues

### "Cannot find module"

Check imports use `#/` alias:
```typescript
// ✅ CORRECT
import { users } from "#/db/schema";

// ❌ WRONG
import { users } from "../src/db/schema";
```

### Database connection failed

```bash
# Ensure PostgreSQL is running
docker compose up -d postgres

# Verify test database exists
docker exec bhayanak-postgres psql -U postgres -l
```

### Test timeout

Increase timeout in vitest.config.ts:
```typescript
testTimeout: 30000,  // 30 seconds
```

### Async test not completing

Ensure all async operations are awaited:
```typescript
// ✅ CORRECT
it("tests async", async () => {
  const result = await fetchData();
  expect(result).toBeDefined();
});

// ❌ WRONG - Missing await
it("tests async", () => {
  const result = fetchData();
  expect(result).toBeDefined();
});
```

## Best Practices

1. **Test behavior, not implementation:**
   ```typescript
   // ✅ Test what user sees
   expect(screen.getByText("Room created")).toBeInTheDocument();
   
   // ❌ Don't test internal state
   expect(component.state.rooms).toHaveLength(1);
   ```

2. **One assertion per test (usually):**
   ```typescript
   // ✅ Clear what failed
   it("shows room name", () => { ... });
   it("shows participant count", () => { ... });
   ```

3. **Use descriptive test names:**
   ```typescript
   // ✅ Clear intent
   it("blocks 4th room creation within 1 minute", () => { ... });
   
   // ❌ Vague
   it("rate limiting works", () => { ... });
   ```

4. **Clean up after tests:**
   ```typescript
   afterEach(() => {
     vi.clearAllMocks();
     cleanup();
   });
   ```

## CI/CD Testing

Tests run automatically on:
- Pull requests
- Pushes to main branch

```yaml
# .github/workflows/test.yml
- name: Run tests
  run: |
    pnpm test:setup
    pnpm test
    pnpm test:coverage
```

## WebRTC Testing

WebRTC tests require special mocking of browser APIs:

### Mock MediaDevices

```typescript
const mockGetDisplayMedia = vi.fn();
const mockGetUserMedia = vi.fn();

Object.defineProperty(globalThis.navigator, "mediaDevices", {
  value: {
    getDisplayMedia: mockGetDisplayMedia,
    getUserMedia: mockGetUserMedia,
  },
  writable: true,
  configurable: true,
});
```

### Mock MediaStream

```typescript
globalThis.MediaStream = vi.fn().mockImplementation((tracks) => ({
  getTracks: () => tracks || [],
  getVideoTracks: () => tracks?.filter((t) => t.kind === "video") || [],
  getAudioTracks: () => tracks?.filter((t) => t.kind === "audio") || [],
  addTrack: vi.fn(),
  removeTrack: vi.fn(),
}));
```

### Mock RTCPeerConnection

```typescript
globalThis.RTCPeerConnection = vi.fn().mockImplementation(() => ({
  createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "test" }),
  createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "test" }),
  setLocalDescription: vi.fn(),
  setRemoteDescription: vi.fn(),
  addIceCandidate: vi.fn(),
  close: vi.fn(),
  onicecandidate: null,
  ontrack: null,
}));
```

## E2E Testing with Playwright

**23 E2E tests** covering critical user flows in real browsers.

### Quick Start

```bash
# Install Playwright browsers (one-time setup)
pnpm exec playwright install

# Run all E2E tests (requires dev server running)
pnpm dev              # Terminal 1
pnpm test:e2e         # Terminal 2

# Run specific E2E test file
pnpm test:e2e e2e/tests/screen-sharing.spec.ts

# Run with UI mode for debugging
pnpm test:e2e:ui

# Run in headed mode (see browser)
pnpm exec playwright test --headed
```

### E2E Test Structure

```
e2e/
├── fixtures/
│   └── streaming.ts            # E2E test helpers
├── tests/
│   ├── room-management.spec.ts # 6 tests - Room creation, joining, leaving
│   ├── screen-sharing.spec.ts  # 6 tests - WebRTC streaming flows
│   ├── streamer-transfer.spec.ts # 4 tests - Streamer transfer with reconnection
│   └── chat.spec.ts            # 7 tests - Chat functionality
├── playwright.config.ts        # Configuration
└── README.md                   # E2E documentation
```

### E2E Test Coverage

| Suite | Tests | Coverage |
|-------|-------|----------|
| Room Management | 6 | Create, join, leave rooms |
| Screen Sharing | 6 | Start/stop streaming, viewer experience |
| Streamer Transfer | 4 | Ownership transfer, reconnection |
| Chat | 7 | Messages, moderation, rate limiting |
| **Total** | **23** | Critical user flows |

### Helper Functions

```typescript
// Start screen sharing in E2E test
await startScreenSharing(page);

// Join room as viewer
await joinRoomAsViewer(page, roomUrl);

// Verify video is playing
await verifyVideoPlaying(page);

// Create authenticated user
const user = await createAuthenticatedUser(page);

// Create a room
await createRoom(page, "Test Room");
```

### E2E Test Example

```typescript
// e2e/tests/screen-sharing.spec.ts
test("user can start screen sharing", async ({ page }) => {
  // Create room and join
  await page.goto("/");
  await page.click("text=Create Room");
  await page.fill("input[name=name]", "Test Room");
  await page.click("button[type=submit]");

  // Start streaming
  await page.click("text=Start Streaming");
  
  // Verify streaming indicator
  await expect(page.locator("text=LIVE")).toBeVisible();
  
  // Verify video element exists
  await expect(page.locator("video")).toBeVisible();
});
```

### Why E2E Tests Are Important

E2E tests complement unit/integration tests by:

1. **Testing real browser behavior** - WebRTC, screen sharing, etc.
2. **Testing the full stack** - Frontend, WebSocket, database
3. **Catching integration issues** - That unit tests miss
4. **Validating user flows** - End-to-end scenarios
5. **Replacing skipped integration tests** - 23 E2E tests cover what 36 skipped tests would test

### Running E2E Tests in CI

```yaml
# .github/workflows/playwright.yml
- name: Run Playwright tests
  run: |
    pnpm dev &
    sleep 5  # Wait for server
    pnpm test:e2e
```

### E2E vs Integration Tests

| Aspect | E2E (Playwright) | Integration (Vitest) |
|--------|------------------|---------------------|
| **Speed** | Slower (real browser) | Fast (jsdom) |
| **Coverage** | Full stack | Isolated layers |
| **Reliability** | More flaky | More stable |
| **Debugging** | UI mode, screenshots | Console output |
| **Use case** | Critical flows, WebRTC | Logic, components |

**Best Practice:** Use both! Unit tests for logic, E2E for critical user flows.

## See Also

- [Integration Test Limitations](./INTEGRATION_TEST_LIMITATIONS.md) - Why some tests are skipped
- [Project Structure](./PROJECT_STRUCTURE.md) - Test organization
- [Rate Limiting](./RATE_LIMITING.md) - Rate limit test examples
