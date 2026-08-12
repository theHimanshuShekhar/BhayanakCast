import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: 'stream-start.spec.ts',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          headless: false,
          // Chromium's fake-media UI bypass selects the synthetic `screen:0:0`,
          // which Xvfb cannot open. Let the picker enumerate its real X11 screen,
          // then have Chromium's test-only selector accept that source.
          args: [
            '--auto-select-screen-capture-source',
          ],
        },
      },
    },
  ],
})
