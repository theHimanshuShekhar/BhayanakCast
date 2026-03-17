# BhayanakCast E2E Tests

End-to-end testing suite using Playwright for the WebRTC streaming platform.

## Overview

This directory contains comprehensive E2E tests for:
- Room management (creation, joining, search)
- WebRTC screen sharing
- Streamer transfer (automatic and manual)
- Real-time chat
- Mobile restrictions

## Test Structure

```
e2e/
├── fixtures/
│   └── streaming.ts          # Test utilities and helpers
├── setup/
│   └── global-teardown.ts    # Cleanup test users after suite
├── tests/
│   ├── room-management.spec.ts    # Room CRUD operations
│   ├── chat.spec.ts              # Real-time chat
│   ├── room-leaving.spec.ts      # Room leaving and rejoining
│   ├── room-status.spec.ts       # Status transitions
│   ├── websocket-reconnect.spec.ts # Reconnection handling
│   ├── rate-limiting.spec.ts     # Rate limiting enforcement
│   ├── room-list.spec.ts         # Home page and room list
│   ├── user-presence.spec.ts     # User indicators
│   ├── error-handling.spec.ts    # Error scenarios
│   ├── auth-flow.example.spec.ts # Test auth examples
│   └── webrtc/
│       ├── screen-sharing.spec.ts     # WebRTC streaming
│       └── streamer-transfer.spec.ts  # Streamer handoff
├── utils/
│   ├── auth.ts                 # Test authentication utilities
│   └── test-helpers.ts         # Test helpers
├── example.spec.ts             # Playwright example
└── README.md                   # This file
```

## Test Coverage

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

## Test Authentication

E2E tests use programmatic test authentication to create users without Discord OAuth.

### How It Works

1. **Email/Password Auth Enabled** - Only in `NODE_ENV=test`
2. **Test API Endpoints** - Create users via `/api/test/auth/signup`
3. **Automatic Cleanup** - Test users deleted after test suite
4. **Random Emails** - Format: `test-{random}@test.example.com`

### Using Test Auth in Tests

```typescript
import { test, expect } from "../utils/auth";

test("streamer and viewer interaction", async ({ browser, signupTestUser }) => {
  // Create test users
  const streamer = await signupTestUser("Test Streamer");
  const viewer = await signupTestUser("Test Viewer");

  // Create authenticated browser contexts
  const streamerContext = await browser.newContext({
    storageState: {
      cookies: [{
        name: "auth-token",
        value: streamer.token,
        domain: "localhost",
        path: "/",
        expires: Date.now() / 1000 + 3600,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      }],
      origins: [],
    },
  });

  const streamerPage = await streamerContext.newPage();
  
  // Now streamer is logged in!
  await streamerPage.goto("/");
  await streamerPage.click('button:has-text("Create Room")');
  // ... rest of test
});
```

### Test Auth Utilities

Located in `e2e/utils/auth.ts`:

- `signupTestUser(name)` - Create new test user
- `loginTestUser(email)` - Login existing test user  
- `cleanupAllTestUsers()` - Delete all test users
- `test` fixture - Extended Playwright test with auth helpers

### Test User Details

- **Email**: `test-{random}@test.example.com`
- **Password**: `testpassword123` (handled automatically)
- **Token**: JWT token returned from API
- **Cleanup**: Automatic after test suite via `global-teardown.ts`

### Security

- ✅ Email/password auth only in `NODE_ENV=test`
- ✅ API endpoints reject requests in production
- ✅ Test users have "test" in email for easy identification
- ✅ Global teardown ensures no test data persists

## Running Tests

### Prerequisites

```bash
# Install Playwright browsers
pnpm exec playwright install

# Install dependencies
pnpm install

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
pnpm test:e2e e2e/tests/room-management.spec.ts
pnpm test:e2e e2e/tests/chat.spec.ts

# Room lifecycle
pnpm test:e2e e2e/tests/room-leaving.spec.ts
pnpm test:e2e e2e/tests/room-status.spec.ts

# WebRTC (in webrtc/ folder)
pnpm test:e2e e2e/tests/webrtc/screen-sharing.spec.ts
pnpm test:e2e e2e/tests/webrtc/streamer-transfer.spec.ts

# Other features
pnpm test:e2e e2e/tests/rate-limiting.spec.ts
pnpm test:e2e e2e/tests/room-list.spec.ts
pnpm test:e2e e2e/tests/user-presence.spec.ts
pnpm test:e2e e2e/tests/error-handling.spec.ts
```

### Run with UI Mode

```bash
pnpm test:e2e:ui
```

### Run in Headed Mode (see browser)

```bash
pnpm exec playwright test --headed
```

## Configuration

### Browsers

Tests run on **Chromium** with screen sharing permissions enabled.

### WebRTC Configuration

Chrome is configured with flags for automated testing:
- `--use-fake-device-for-media-stream` - Use fake media devices
- `--use-fake-ui-for-media-stream` - Auto-accept permissions
- `--auto-select-desktop-capture-source` - Auto-select screen

### Test Timeouts

- **Test timeout:** 60 seconds
- **Expect timeout:** 10 seconds
- **Action timeout:** 10 seconds

## Writing E2E Tests

### Basic Structure

```typescript
import { test, expect } from "@playwright/test";

test.describe("Feature Name", () => {
  test("test description", async ({ page }) => {
    // Test code
  });
});
```

### Multi-User Tests with Auth

```typescript
import { test, expect } from "../utils/auth";

test("two users can chat", async ({ browser, signupTestUser }) => {
  // Create authenticated users
  const user1 = await signupTestUser("User 1");
  const user2 = await signupTestUser("User 2");

  // Create contexts with auth
  const context1 = await browser.newContext({
    storageState: {
      cookies: [{ name: "auth-token", value: user1.token, /* ... */ }],
      origins: [],
    },
  });
  const context2 = await browser.newContext({
    storageState: {
      cookies: [{ name: "auth-token", value: user2.token, /* ... */ }],
      origins: [],
    },
  });
  
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();
  
  try {
    // Both users are now logged in!
    await page1.goto("/");
    await page2.goto("/");
    // ... test interactions
  } finally {
    await context1.close();
    await context2.close();
  }
});
```

### Using Test Helpers

```typescript
import { generateUniqueRoomName } from "../utils/test-helpers";

// Creates unique room names to prevent conflicts
const roomName = generateUniqueRoomName("Test Room");
// Result: "Test Room-W0-1234567890"
```

## CI/CD Integration

Tests run automatically via GitHub Actions:

```yaml
# .github/workflows/playwright.yml
- name: Run Playwright tests
  run: pnpm test:e2e
```

## Debugging

### View Trace

```bash
# Run with trace
pnpm exec playwright test --trace on

# View trace
pnpm exec playwright show-trace trace.zip
```

### View Report

```bash
# Generate and view HTML report
pnpm exec playwright test
pnpm exec playwright show-report
```

### Screenshot on Failure

Screenshots are automatically captured on test failure:
```
test-results/
  └── <test-name>-<browser>/
      └── test-failed-1.png
```

### Video Recording

Videos are recorded for failed tests:
```
test-results/
  └── <test-name>-<browser>/
      └── video.webm
```

## Best Practices

1. **Use test auth fixtures** for authenticated tests:
   ```typescript
   import { test, expect } from "../utils/auth";
   ```

2. **Generate unique room names** to prevent conflicts:
   ```typescript
   const roomName = generateUniqueRoomName("Test Room");
   ```

3. **Clean up contexts** after multi-user tests:
   ```typescript
   await context.close();
   ```

4. **Use try/finally** for cleanup:
   ```typescript
   try {
     // Test code
   } finally {
     await context.close();
   }
   ```

5. **Avoid hardcoded timeouts** - Use expect timeouts instead

## Common Issues

### Tests Timing Out

Increase timeout in `playwright.config.ts`:
```typescript
timeout: 90000,  // 90 seconds
```

### Port Already in Use

Kill existing processes:
```bash
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```

### Authentication Failures

Ensure dev server is running with `NODE_ENV=test`:
```bash
# In playwright.config.ts, webServer.env sets this automatically
NODE_ENV=test pnpm dev
```

## Environment Variables

```bash
# Base URL for tests
BASE_URL=http://localhost:3000

# Run in CI mode
CI=true
```

## See Also

- [Playwright Documentation](https://playwright.dev/)
- [WebRTC Testing Guide](https://playwright.dev/docs/api/class-browser#browser-new-context-option-permissions)
- [Main Testing Guide](../docs/TESTING.md)
- [Test Auth Example](../e2e/tests/auth-flow.example.spec.ts)
