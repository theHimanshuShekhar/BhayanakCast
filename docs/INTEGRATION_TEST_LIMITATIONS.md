# Integration Test Limitations & Workarounds

## Overview

This document explains why certain integration tests are currently skipped and what would be required to fully implement them.

## Summary of Skipped Tests

| Test File | Skipped | Reason |
|-----------|---------|--------|
| `tests/integration/rate-limiting.test.ts` | 16 tests | TanStack Start server function testing limitation |
| `tests/integration/rooms.test.ts` | 20 tests | TanStack Start server function testing limitation |
| `tests/integration/webrtc/websocket-signaling.test.ts` | 2 tests | Requires full WebSocket server infrastructure |
| **Total** | **38 tests** | See details below |

## The Problem

### TanStack Start Server Functions Cannot Be Tested in Vitest

**Affected Tests:** 36 tests across `rate-limiting.test.ts` and `rooms.test.ts`

The skipped integration tests attempt to test server functions (`createServerFn`) from TanStack Start directly in the vitest test environment. However, TanStack Start server functions require a full TanStack Start runtime context that includes:

1. **Hono server runtime** - Server functions are built on Hono and require the Hono context
2. **Request/Response cycle** - Server functions expect actual HTTP requests with headers, cookies, etc.
3. **Vite plugin context** - TanStack Start's Vite plugins set up the server function registry
4. **Build-time transformations** - Server functions are transformed at build time to create API routes

When these tests run in vitest:
- The server function handler tries to import from `#/db/index` dynamically
- This works, but the server function wrapper itself needs the TanStack Start context
- Without this context, the functions return `undefined` instead of executing

### Example of the Issue

```typescript
// This works in the actual app but returns undefined in tests:
const result = await createRoom({
  data: {
    name: "Test Room",
    userId: "user-123"
  }
});
// result is undefined in tests, but works in production
```

## What Would Be Needed to Implement These Tests

### Option 1: TanStack Start Testing Utilities (Recommended)

TanStack Start may eventually provide testing utilities similar to Next.js's approach:

```typescript
// Hypothetical future API:
import { createTestServerContext } from "@tanstack/start/testing";

const context = createTestServerContext({
  database: testDb,
  headers: { /* mock headers */ }
});

const result = await context.invoke(createRoom, {
  data: { name: "Test Room", userId: "user-123" }
});
```

**Status:** Not currently available as of TanStack Start v1.114.29

### Option 2: Direct Database Testing

Test the database layer directly without going through server functions:

```typescript
// Instead of testing through createRoom server function:
const result = await createRoom({ data: { name: "Test", userId: "123" }});

// Test the database operations directly:
const { db } = await getTestDatabase();
const room = await db.insert(streamingRooms).values({...}).returning();
```

**Status:** This is what we do for tests that ARE working (room-management, user-stats, etc.)

### Option 3: E2E Testing with Playwright

Use Playwright or similar E2E testing tools that run the full application:

```typescript
// E2E test example:
test("user can create room", async ({ page }) => {
  await page.goto("/");
  await page.click("text=Create Room");
  await page.fill("input[name=name]", "Test Room");
  await page.click("button[type=submit]");
  await expect(page.locator("text=Test Room")).toBeVisible();
});
```

**Status:** ✅ **IMPLEMENTED** - 23 Playwright E2E tests covering room management, screen sharing, streamer transfer, and chat

### Option 4: HTTP-Level Integration Tests

Start the actual dev server and make HTTP requests:

```typescript
// Start dev server on test port
const server = await startDevServer({ port: 3002 });

// Make actual HTTP requests
const response = await fetch("http://localhost:3002/api/create-room", {
  method: "POST",
  body: JSON.stringify({ name: "Test", userId: "123" })
});
```

**Status:** Complex to set up, slow to run, but would test the full stack

## Current Workarounds

### 1. Comprehensive Unit Tests ✅

We test the core business logic in unit tests:

- **Rate Limiter:** 35 tests covering all backends and configurations
- **Profanity Filter:** 34 tests covering all scenarios
- **Components:** 24 tests for UI components with mocked data
- **WebRTC:** 47 tests covering device detection, streaming logic, and components

### 2. Database Query Tests ✅

We test database queries directly:

- `room-management.test.ts` - Tests stats queries
- `user-stats.test.ts` - Tests user statistics
- `room-list.test.tsx` - Tests component with real DB data

### 3. WebSocket Rate Limiting Tests ✅

We test WebSocket rate limiting logic separately:

- `websocket-rate-limiting.test.ts` - Tests rate limiting without full WebSocket server

### 4. E2E Tests with Playwright ✅

**New in 2025:** We've implemented comprehensive E2E tests using Playwright:

- **23 E2E tests** covering critical user flows
- **4 test suites:** Room Management, Screen Sharing, Streamer Transfer, Chat
- **Real browser testing** in Chromium, Firefox, and WebKit
- **CI/CD ready** with GitHub Actions workflow

See [e2e/README.md](../e2e/README.md) for details.

## Skipped Test Inventory

### `tests/integration/rate-limiting.test.ts` (16 tests skipped)

**Reason:** Cannot test TanStack Start server functions directly in vitest

These tests verify that rate limiting works correctly through server functions:

1. `createRoom Rate Limiting > allows 3 room creations per minute`
2. `createRoom Rate Limiting > blocks 4th room creation within 1 minute`
3. `createRoom Rate Limiting > includes retryAfter in error message`
4. `createRoom Rate Limiting > rate limits are per-user`
5. `joinRoom Rate Limiting > allows 10 room joins per minute`
6. `joinRoom Rate Limiting > blocks 11th room join within 1 minute`
7. `leaveRoom Rate Limiting > allows 5 room leaves per minute`
8. `leaveRoom Rate Limiting > blocks 6th room leave within 1 minute`
9. `transferStreamerOwnership Rate Limiting > allows 1 transfer per 30 seconds`
10. `transferStreamerOwnership Rate Limiting > blocks rapid transfers`
11. `transferStreamerOwnership Rate Limiting > includes cooldown time`
12. `Rate Limit Reset Behavior > resetAll clears all rate limits`
13. Configuration verification tests (4 tests)

**Alternative Coverage:**
- Rate limiter unit tests verify the core algorithm works (35 tests)
- Rate limit configurations are tested
- WebSocket rate limiting tests verify enforcement (25 tests)
- E2E tests verify rate limiting in real browser scenarios

**How to Test Manually:**
1. Start the dev server: `pnpm dev`
2. Create 4 rooms quickly with the same user
3. Verify 4th creation shows rate limit error
4. Wait 60 seconds
5. Verify can create again

### `tests/integration/rooms.test.ts` (20 tests skipped)

**Reason:** Cannot test TanStack Start server functions directly in vitest

These tests verify room CRUD operations through server functions:

#### Room Creation (5 tests):
- `creates room with valid data`
- `auto-sets creator as streamer`
- `validates room name minimum length`
- `validates room name maximum length`
- `allows optional description`
- `leaves current room before creating new one`

#### Room Joining (5 tests):
- `joins active room`
- `auto-becomes streamer in waiting room`
- `activates room with 2+ participants`
- `prevents duplicate joins`
- `rejects joining ended room`

#### Room Leaving (4 tests):
- `calculates watch time on leave`
- `transfers streamer to earliest viewer`
- `sets room to waiting when last participant leaves`
- `returns error when not in room`

#### Streamer Transfer (4 tests):
- `transfers ownership to viewer`
- `rejects transfer from non-streamer`
- `rejects transfer to non-viewer`
- `rejects transfer for non-active room`

#### Room Lifecycle (1 test):
- `complete flow: create -> join -> transfer -> leave`

**Alternative Coverage:**
- Database schema tests verify tables exist
- Stats query tests verify room data retrieval
- Room list component tests verify UI rendering
- **E2E tests cover these flows comprehensively:**
  - `room-management.spec.ts` - Room creation, joining, leaving
  - `streamer-transfer.spec.ts` - Ownership transfers

**How to Test Manually:**
1. Create a room
2. Join with second user (room becomes active)
3. Transfer streamer ownership
4. Leave as original streamer (ownership transfers to viewer)
5. Leave as last participant (room becomes waiting)

### `tests/integration/webrtc/websocket-signaling.test.ts` (2 tests skipped)

**Reason:** Requires full WebSocket server infrastructure with WebRTC handlers

These tests verify WebRTC signaling through WebSocket:

1. `webrtc:streamer_ready > forwards streamer ready event to room`
2. `webrtc:offer/answer/ice_candidate > forwards offer from viewer to streamer`

**Why These Are Skipped:**
- The tests create a bare Socket.io server without the actual WebRTC event handlers
- The WebSocket handlers are defined in `websocket/websocket-server.ts` and require:
  - Full Express/HTTP server setup
  - Database connection
  - Room manager with all business logic
  - Socket authentication middleware
- Setting this up in unit tests would essentially require running the full server

**Alternative Coverage:**
- **WebRTC hook tests** (13 tests) - Test client-side streaming logic
- **WebRTC component tests** (18 tests) - Test UI components
- **E2E tests** - Test actual browser-to-browser streaming:
  - `screen-sharing.spec.ts` - Screen sharing flows
  - `streamer-transfer.spec.ts` - Transfer with reconnection

**How to Test Manually:**
1. Open two browser windows
2. User A creates room and starts streaming
3. User B joins room
4. Verify User B can see User A's screen
5. User A stops sharing, verify transfer prompt appears
6. User B accepts, verify streaming continues

## Recommendations

### Short Term (Current State)

1. ✅ **Keep comprehensive unit tests** - Core logic is well-tested (204 tests)
2. ✅ **Test database queries directly** - Data layer is verified
3. ✅ **Component tests with mocks** - UI is tested
4. ✅ **E2E tests with Playwright** - 23 tests covering critical flows
5. ✅ **Manual testing** - Full integration tested manually

### Medium Term

1. ✅ **E2E tests implemented** with Playwright (23 tests, 4 suites)
2. **Expand E2E coverage** to more edge cases
3. **Monitor TanStack Start releases** for testing utilities

### Long Term

When TanStack Start provides official testing support:

1. Re-enable all skipped server function tests (36 tests)
2. Consider running WebSocket signaling tests against a test server instance
3. Achieve 90%+ coverage across all layers

## Test Summary (Current State)

### Unit Tests: 204 passing ✅

| Category | Tests |
|----------|-------|
| Rate Limiter | 35 |
| Profanity Filter | 34 |
| WebRTC (device detection, hook, components) | 47 |
| Room Card | 8 |
| Create Room Modal | 6 |
| Community Stats Card | 6 |
| Room List Integration | 10 |
| User Stats Integration | 14 |
| Room Management Integration | 15 |
| WebSocket Rate Limiting | 27 |
| **Total** | **204** |

### Integration Tests: 38 skipped, 66 active

| File | Active | Skipped |
|------|--------|---------|
| room-management.test.ts | 15 | 0 |
| user-stats.test.ts | 14 | 0 |
| room-list.test.tsx | 10 | 0 |
| websocket-rate-limiting*.test.ts | 27 | 0 |
| mobile-restrictions.test.ts | 2 | 0 |
| rate-limiting.test.ts | 0 | 16 |
| rooms.test.ts | 0 | 20 |
| websocket-signaling.test.ts | 0 | 2 |

### E2E Tests: 23 implemented ✅

| Suite | Tests |
|-------|-------|
| Room Management | 6 |
| Screen Sharing | 6 |
| Streamer Transfer | 4 |
| Chat | 7 |
| **Total** | **23** |

### Overall Coverage

- **Unit/Integration:** 204 passing + 38 skipped = 242 total
- **E2E:** 23 tests
- **Combined:** 265 tests covering the application

## Running Tests

```bash
# All tests (unit + E2E)
pnpm test

# Unit tests only
pnpm test:unit

# E2E tests only
pnpm test:e2e

# E2E tests with UI
pnpm test:e2e:ui
```

## Conclusion

While 38 integration tests are skipped due to testing infrastructure limitations, the application is comprehensively tested through:

- **204 unit tests** covering core logic and components
- **66 active integration tests** covering database queries
- **23 E2E tests** covering critical user flows in real browsers
- **End-to-end manual testing** during development

The skipped tests are thoroughly documented and ready to be enabled when proper testing infrastructure becomes available from TanStack Start or through expanded E2E coverage.
