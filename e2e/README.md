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
├── tests/
│   ├── room-management.spec.ts    # Room CRUD operations
│   ├── screen-sharing.spec.ts     # WebRTC streaming
│   ├── streamer-transfer.spec.ts  # Streamer handoff
│   ├── chat.spec.ts              # Real-time chat
│   ├── room-leaving.spec.ts      # Room leaving and rejoining
│   ├── room-status.spec.ts       # Status transitions
│   ├── websocket-reconnect.spec.ts # Reconnection handling
│   ├── rate-limiting.spec.ts     # Rate limiting enforcement
│   ├── room-list.spec.ts         # Home page and room list
│   ├── user-presence.spec.ts     # User indicators
│   └── error-handling.spec.ts    # Error scenarios
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

### Screen Sharing (6 tests)
- ✅ Start screen sharing
- ✅ Audio configuration selection
- ✅ Stop screen sharing
- ✅ Viewer sees stream
- ✅ Multiple viewers
- ✅ Mobile restrictions

### Streamer Transfer (4 tests)
- ✅ Automatic transfer when streamer leaves
- ✅ Manual transfer to viewer
- ✅ Transfer cooldown (30s)
- ✅ Room enters waiting state

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

**Total: 53 E2E Tests**

## Running Tests

### Prerequisites

```bash
# Install Playwright browsers
pnpm exec playwright install

# Install dependencies
pnpm install
```

### Run All E2E Tests

```bash
pnpm exec playwright test
```

### Run Specific Test File

```bash
# Core functionality
pnpm exec playwright test e2e/tests/room-management.spec.ts
pnpm exec playwright test e2e/tests/screen-sharing.spec.ts
pnpm exec playwright test e2e/tests/streamer-transfer.spec.ts
pnpm exec playwright test e2e/tests/chat.spec.ts

# Room lifecycle
pnpm exec playwright test e2e/tests/room-leaving.spec.ts
pnpm exec playwright test e2e/tests/room-status.spec.ts
pnpm exec playwright test e2e/tests/websocket-reconnect.spec.ts

# Additional features
pnpm exec playwright test e2e/tests/rate-limiting.spec.ts
pnpm exec playwright test e2e/tests/room-list.spec.ts
pnpm exec playwright test e2e/tests/user-presence.spec.ts
pnpm exec playwright test e2e/tests/error-handling.spec.ts
```

### Run with UI Mode

```bash
pnpm exec playwright test --ui
```

### Run in Headed Mode (see browser)

```bash
pnpm exec playwright test --headed
```

### Run Specific Browser

```bash
pnpm exec playwright test --project=chromium
pnpm exec playwright test --project=firefox
```

## Configuration

### Browsers

Tests run on:
- **Chromium** (primary) - With screen sharing permissions
- **Firefox** (secondary) - Alternative browser testing
- **Mobile Chrome** - Mobile viewport testing

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

### Multi-User Tests

```typescript
test("two users can chat", async ({ browser }) => {
  const context1 = await browser.newContext();
  const page1 = await context1.newPage();
  
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  
  try {
    // User 1 creates room
    await page1.goto("/");
    // ...
    
    // User 2 joins
    await page2.goto(roomUrl);
    // ...
    
  } finally {
    await context1.close();
    await context2.close();
  }
});
```

### Using Fixtures

```typescript
import { test, expect } from "../fixtures/streaming";

test("streamer can share screen", async ({ streamerPage }) => {
  await streamerPage.goto("/");
  // Already has display-capture permission
});
```

## CI/CD Integration

Tests run automatically via GitHub Actions:

```yaml
# .github/workflows/playwright.yml
- name: Run Playwright tests
  run: pnpm exec playwright test
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

1. **Use data-testid attributes** for reliable selectors:
   ```html
   <div data-testid="room-container">
   ```

2. **Wait for network idle** when loading pages:
   ```typescript
   await page.goto("/", { waitUntil: "networkidle" });
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

### WebRTC Permissions Denied

Ensure Chrome flags are set in `playwright.config.ts`:
```typescript
launchOptions: {
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
}
```

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
