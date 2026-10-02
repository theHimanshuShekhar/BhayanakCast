import { defineConfig, devices } from "@playwright/test";
import { E2E_ADMIN_DISCORD_ID } from "./e2e/auth";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

// ADR 0017/0018: E2E on Chromium and Firefox with fake media devices.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // In CI: annotations on the run, plus an HTML report the nightly workflow uploads on failure.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Parallel browsers on a loaded machine render slowly (Firefox especially), so a page can
  // take longer than the 5s expect default and a multi-page test longer than 30s.
  timeout: 60_000,
  expect: { timeout: 10_000 },
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
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            // Screen sharing (#36) picks the (fake) screen without a picker.
            "--auto-select-desktop-capture-source=Entire screen",
          ],
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
  // The prod build against an in-memory PGlite, with the test-only sign-in enabled (e2e/serve.ts)
  // and one fake Discord id bootstrapped as admin.
  webServer: {
    // NODE_ENV=development on the server only: it takes the non-production env schema the
    // test-only sign-in needs. Set in `env` below, it would reach `pnpm build` too.
    command: "pnpm build && NODE_ENV=development node e2e/serve.ts",
    url: baseURL,
    env: {
      PORT: String(PORT),
      BETTER_AUTH_URL: baseURL,
      E2E_AUTH: "1",
      ADMIN_DISCORD_IDS: E2E_ADMIN_DISCORD_ID,
      // Tests give each browser its own client IP via `cf-connecting-ip` (e.g. so sign-in rate
      // limits aren't shared); the browsers connect from loopback, so trust it as the proxy.
      TRUSTED_PROXY_IPS: "127.0.0.1,::1",
      // Every test's visitor pages connect from 127.0.0.1 at once.
      REALTIME_ANONYMOUS_SOCKETS_PER_IP: "1000",
      // Empty rooms end after 60s, not 5 minutes, so a test can watch one end
      // (e2e/lifecycle.spec.ts). A room is empty from its creation too (its creator is still in
      // the pre-join lobby), and tests leave and revisit rooms: 60s leaves room to spare on a
      // loaded machine.
      REALTIME_EMPTY_ROOM_TIMEOUT_MS: "60000",
      // A share's thumbnail refreshes every 8s, not 3 minutes (e2e/thumbnails.spec.ts); Vite
      // inlines it into the client at build time.
      VITE_THUMBNAIL_REFRESH_MS: "8000",
      // The rail's count shows at once, not after 3s (src/lib/lobby-live.ts): other tests'
      // sockets come and go all the time, and a settled count would hide the changes the
      // lobby spec records. The settling is covered by unit tests.
      VITE_ONLINE_SETTLE_MS: "0",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
