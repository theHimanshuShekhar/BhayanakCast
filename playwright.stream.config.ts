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
          args: [
            '--use-fake-ui-for-media-stream',
            '--auto-select-desktop-capture-source=Entire screen',
          ],
        },
      },
    },
  ],
})
