# BhayanakCast E2E Tests

End-to-end testing suite using Playwright for the WebRTC streaming platform.

## Quick Start

```bash
# Install Playwright browsers (one-time)
pnpm exec playwright install

# Run all E2E tests
pnpm test:e2e

# Run specific test file
pnpm test:e2e e2e/tests/auth-flow.example.spec.ts

# Run with UI mode for debugging
pnpm test:e2e:ui
```

## ⚠️ Critical: Test Authentication System

### Overview

E2E tests use **UI-based authentication** to create test users programmatically without Discord OAuth.

**How it works:**
1. **Email/Password Auth** - Enabled only in `NODE_ENV=test`
2. **Test API Endpoints** - Create users via `/api/test/auth/signup`
3. **UI Login Flow** - Tests login through the actual UI (not cookies)
4. **Automatic Cleanup** - Test users deleted after test suite

### ⚠️ IMPORTANT: Login via UI Required

**DO NOT use cookie-based authentication.** Better Auth's session management requires actual UI login flow.

**Correct Pattern:**
```typescript
import { test, expect } from "../utils/auth";

const TEST_VIEWPORT = { width: 1200, height: 800 };

async function loginUser(page: any, email: string) {
  await page.goto("/auth/sign-in");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "testpassword123");
  await page.click('button[type="submit"]');

  await page.waitForURL("http://localhost:3000/", { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
}

test("example", async ({ page, signupTestUser }) => {
  const user = await signupTestUser("Test User");
  await loginUser(page, user.email);
  await page.setViewportSize(TEST_VIEWPORT); // AFTER login!
  // ... test code
});
```

### Critical Requirements

1. **Always login via UI** - Never set cookies directly
2. **Set viewport AFTER login** - Setting viewport before login breaks the form
3. **Use `force: true` for Create Room button** - Button may be hidden at certain viewports
4. **Use `TEST_VIEWPORT`** - 1200x800 ensures Create Room button is visible

### Complete Working Example

```typescript
import { test, expect } from "../utils/auth";
import { generateUniqueRoomName } from "../utils/test-helpers";

const TEST_VIEWPORT = { width: 1200, height: 800 };

async function loginUser(page: any, email: string) {
  await page.goto("/auth/sign-in");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "testpassword123");
  await page.click('button[type="submit"]');

  await page.waitForURL("http://localhost:3000/", { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
}

test("streamer creates room and viewer joins", async ({ browser, signupTestUser }) => {
  // Create test users
  const streamer = await signupTestUser("Streamer");
  const viewer = await signupTestUser("Viewer");

  // Create contexts
  const streamerCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const streamerPage = await streamerCtx.newPage();
  const viewerPage = await viewerCtx.newPage();

  try {
    // Login via UI
    await loginUser(streamerPage, streamer.email);
    await loginUser(viewerPage, viewer.email);

    // Set viewports AFTER login
    await streamerPage.setViewportSize(TEST_VIEWPORT);
    await viewerPage.setViewportSize(TEST_VIEWPORT);
    await streamerPage.waitForTimeout(500);
    await viewerPage.waitForTimeout(500);

    // Create room with force click
    await streamerPage.locator('button:has-text("Create Room")').first().click({ force: true });
    await streamerPage.fill('input[placeholder*="room name"]', "Test Room");
    await streamerPage.click('button[type="submit"]:has-text("Create Room")');
    await streamerPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

    // Viewer joins
    await viewerPage.goto(streamerPage.url());
    await viewerPage.waitForLoadState("networkidle");
    await viewerPage.waitForTimeout(1000);

    // Verify with flexible regex (websocket sync takes time)
    await expect(streamerPage.locator("text=/\\d+ viewers?/")).toBeVisible();
    await expect(viewerPage.locator("text=/\\d+ viewers?/")).toBeVisible();
  } finally {
    await streamerCtx.close();
    await viewerCtx.close();
  }
});
```

## Test Structure

```
e2e/
├── setup/
│   └── global-teardown.ts        # Cleanup test users after suite
├── tests/
│   ├── auth-flow.example.spec.ts # ⭐ Authentication examples
│   ├── room-management.spec.ts   # Room CRUD operations
│   ├── chat.spec.ts              # Real-time chat
│   ├── room-leaving.spec.ts      # Room leaving and rejoining
│   ├── room-status.spec.ts       # Status transitions
│   ├── websocket-reconnect.spec.ts # Reconnection handling
│   ├── rate-limiting.spec.ts     # Rate limiting enforcement
│   ├── room-list.spec.ts         # Home page and room list
│   ├── user-presence.spec.ts     # User indicators
│   ├── error-handling.spec.ts    # Error scenarios
│   └── webrtc/
│       ├── screen-sharing.spec.ts     # WebRTC streaming
│       └── streamer-transfer.spec.ts  # Streamer handoff
├── utils/
│   ├── auth.ts                 # ⭐ Test authentication utilities
│   └── test-helpers.ts         # Test helper functions
└── README.md                   # This file
```

## Test Coverage

### Authentication (2 tests in auth-flow.example.spec.ts)
- ✅ Create test users via API
- ✅ Login via UI flow
- ✅ Multi-user authentication

### Room Management (6 tests)
- ✅ Create new room
- ✅ Browse and join existing rooms
- ✅ Room status indicators
- ✅ Participant count display
- ✅ Leave room and return to home
- ✅ Search and filter rooms

### Chat (7 tests)
- ✅ Send and receive messages
- ✅ Profanity filtering
- ✅ System messages for events
- ✅ Input clears after sending
- ✅ Empty message prevention
- ✅ Rate limiting
- ✅ Message persistence

### Room Leaving (8 tests)
- ✅ User can leave room
- ✅ Participant count updates on leave
- ✅ Automatic streamer transfer on leave
- ✅ Rejoin room after leaving
- ✅ Tab close removes user
- ✅ Multiple users leave independently
- ✅ Status changes on leave
- ✅ Streamer transfer broadcast

### Room Status (7 tests)
- ✅ Room starts in preparing status
- ✅ Room becomes active with 2nd participant
- ✅ Room returns to waiting when empty
- ✅ Streaming starts in preparing
- ✅ Stopping stream returns to preparing
- ✅ Status updates broadcast to all
- ✅ Room data persists after navigation

### WebSocket Reconnection (2 tests)
- ✅ Reconnects after connection loss
- ✅ Multiple users handle reconnection

### Rate Limiting (2 tests)
- ✅ Prevents rapid room creation
- ✅ Allows creation after cooldown

### Room List (4 tests)
- ✅ Displays list of active rooms
- ✅ Clicking room card navigates
- ✅ Shows empty state
- ✅ Create room button opens modal

### User Presence (3 tests)
- ✅ Shows streamer indicator
- ✅ Shows participant list
- ✅ Updates online user count

### Error Handling (4 tests)
- ✅ Shows error for non-existent room
- ✅ Handles server disconnection
- ✅ Validates room name required
- ✅ Validates room name minimum length

### WebRTC - Screen Sharing (6 tests)
- ✅ Start screen sharing
- ✅ Audio configuration selection
- ✅ Stop screen sharing
- ✅ Viewer sees stream
- ✅ Multiple viewers
- ✅ Mobile restrictions

### WebRTC - Streamer Transfer (4 tests)
- ✅ Automatic transfer when streamer leaves
- ✅ Manual transfer to viewer
- ✅ Transfer cooldown (30s)
- ✅ Room enters waiting state

**Total: 53 E2E Tests**

## Running Tests

### Prerequisites

```bash
# Install Playwright browsers
pnpm exec playwright install

# Start dev server (in another terminal)
pnpm dev
```

### Run All E2E Tests

```bash
pnpm test:e2e
```

### Run Specific Test File

```bash
# Core functionality
pnpm test:e2e e2e/tests/auth-flow.example.spec.ts
pnpm test:e2e e2e/tests/room-management.spec.ts
pnpm test:e2e e2e/tests/chat.spec.ts

# WebRTC tests
pnpm test:e2e e2e/tests/webrtc/screen-sharing.spec.ts
pnpm test:e2e e2e/tests/webrtc/streamer-transfer.spec.ts
```

### Run with UI Mode

```bash
pnpm test:e2e:ui
```

## Best Practices

### ✅ DO

1. **Use `signupTestUser` fixture** to create test users
2. **Login via UI** using the `loginUser` helper pattern
3. **Set viewport AFTER login** (never before)
4. **Use `force: true`** when clicking Create Room button
5. **Use `TEST_VIEWPORT`** constant: `{ width: 1200, height: 800 }`
6. **Close contexts in `finally` blocks** for cleanup
7. **Use unique room names** via `generateUniqueRoomName()`
8. **Wait for websocket sync** with `page.waitForTimeout(2000)` before checking viewer counts
9. **Use flexible regex** for viewer counts: `page.locator("text=/\\d+ viewers?/")`

### ❌ DON'T

1. **Don't set cookies directly** - Use UI login instead
2. **Don't set viewport before login** - Breaks the auth form
3. **Don't rely on cookie names** - Better Auth uses `better-auth.session_token`
4. **Don't use exact viewer counts** - Use regex patterns
5. **Don't forget to close contexts** - Leads to resource exhaustion
6. **Don't skip viewport setting** - Create Room button won't be visible

## Common Issues & Solutions

### Issue: "Create Room button not found"

**Cause:** Viewport not set or button hidden

**Solution:**
```typescript
await page.setViewportSize({ width: 1200, height: 800 });
await page.waitForTimeout(500);
await page.locator('button:has-text("Create Room")').first().click({ force: true });
```

### Issue: "Test timeout on login"

**Cause:** Form not submitting or navigation not completing

**Solution:**
- Ensure dev server is running: `pnpm dev`
- Check `NODE_ENV=test` is set in playwright.config.ts
- Add explicit waits after navigation

### Issue: "Viewer count not updating"

**Cause:** Websocket hasn't synced yet

**Solution:**
```typescript
await page.waitForTimeout(2000); // Wait for websocket sync
await expect(page.locator("text=/\\d+ viewers?/")).toBeVisible();
```

### Issue: "Cookie auth not working"

**Cause:** Better Auth requires UI login, not cookie injection

**Solution:** Use the `loginUser()` helper pattern instead of setting cookies.

### Issue: "Socket hang up during cleanup"

**Cause:** Server crashed or not responding

**Solution:**
```bash
# Check if server is running
curl http://localhost:3000

# Restart if needed
pnpm dev
```

## Configuration

### Browsers

Tests run on **Chromium** with screen sharing permissions enabled.

### Test Timeouts

- **Test timeout:** 60 seconds
- **Expect timeout:** 10 seconds
- **Action timeout:** 10 seconds

### Environment Variables

```bash
# Base URL for tests
BASE_URL=http://localhost:3000

# Run in CI mode
CI=true

# Must be 'test' for email/password auth
NODE_ENV=test
```

## Test Utilities

### `e2e/utils/auth.ts`

- `signupTestUser(name)` - Create new test user via API
- `loginUser(page, email)` - Login via UI (pattern to implement)
- `cleanupAllTestUsers()` - Delete all test users
- `test` fixture - Extended Playwright test with auth helpers

### `e2e/utils/test-helpers.ts`

- `generateUniqueRoomName(baseName)` - Generate unique room names
- `generateUniqueUserName(baseName)` - Generate unique usernames

## See Also

- [Test Auth Example](./tests/auth-flow.example.spec.ts) - Working examples
- [Test Auth Utilities](./utils/auth.ts) - Authentication helpers
- [Playwright Documentation](https://playwright.dev/)
- [Main Testing Guide](../docs/TESTING.md)
