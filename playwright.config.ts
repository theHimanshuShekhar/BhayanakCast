import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'stream-start.spec.ts',
  timeout: 120_000,
  // The V1 journey matrix (#26) is only evidence if it passes unaided: a retry lets a
  // flaky journey report green. A genuine flake must be fixed, not absorbed.
  retries: 0,
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    actionTimeout: 15_000,
    // `on-first-retry` cannot fire with retries disabled.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // `pnpm start` loads `.env`, so this server has the same database the
    // developer's own does — and now migrates it at startup.
    command: 'pnpm build && pnpm start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
