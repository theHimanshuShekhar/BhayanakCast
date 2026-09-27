import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

// ADR 0017/0018: E2E on Chromium and Firefox with fake media devices.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          firefoxUserPrefs: {
            "media.navigator.streams.fake": true,
            "media.navigator.permission.disabled": true,
          },
        },
      },
    },
  ],
  // The prod build against an in-memory PGlite, with the test-only sign-in enabled (e2e/serve.ts).
  webServer: {
    command: "pnpm build && node e2e/serve.ts",
    url: baseURL,
    env: { PORT: String(PORT), BETTER_AUTH_URL: baseURL, E2E_AUTH: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
