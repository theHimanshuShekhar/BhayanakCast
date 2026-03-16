import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright Configuration for BhayanakCast E2E Tests
 * 
 * WebRTC Streaming E2E Test Configuration
 */
export default defineConfig({
  testDir: "./e2e/tests",
  
  /* Run tests sequentially for WebRTC (peer connections need ordering) */
  fullyParallel: false,
  
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Single worker for WebRTC tests (peer connections can't share) */
  workers: 1,
  
  /* Reporter configuration */
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  
  /* Shared settings for all tests */
  use: {
    /* Base URL */
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    
    /* Collect trace when retrying the failed test */
    trace: "on-first-retry",
    
    /* Capture screenshots on failure */
    screenshot: "only-on-failure",
    
    /* Record video on failure */
    video: "on-first-retry",
    
    /* Default viewport */
    viewport: { width: 1280, height: 720 },
  },

  /* Configure projects for different scenarios */
  projects: [
    /* Desktop Chrome - Primary testing browser */
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        /* Grant permissions for screen sharing */
        permissions: ["display-capture"],
        /* Chrome args for WebRTC testing */
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--auto-select-desktop-capture-source=Entire screen",
            "--enable-features=WebRtcHideLocalIpsWithMdns",
            "--disable-features=IsolateOrigins,site-per-process",
          ],
        },
      },
    },

    /* Firefox - Secondary browser testing */
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        permissions: ["display-capture"],
        launchOptions: {
          firefoxUserPrefs: {
            "permissions.default.desktop-notification": 1,
            "media.navigator.permission.disabled": true,
            "media.navigator.streams.fake": true,
          },
        },
      },
    },

    /* Mobile Chrome - Mobile testing */
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        permissions: ["display-capture"],
      },
      testMatch: /mobile/,
    },
  ],

  /* Run local dev server before starting the tests */
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      NODE_ENV: "test",
    },
  },

  /* Test timeout - WebRTC operations can take time */
  timeout: 60000,
  
  /* Expect timeout */
  expect: {
    timeout: 10000,
  },
});
