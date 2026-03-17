import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright Configuration for BhayanakCast E2E Tests
 * 
 * All tests run sequentially with single worker to prevent conflicts
 */
export default defineConfig({
  testDir: "./e2e/tests",

  /* Global teardown to cleanup test users */
  globalTeardown: "./e2e/setup/global-teardown.ts",

  /* Run tests sequentially */
  fullyParallel: false,
  
  /* Single worker for all tests */
  workers: 1,
  
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
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

  /* Single project for all tests */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
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
