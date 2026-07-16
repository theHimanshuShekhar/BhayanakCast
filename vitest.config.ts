import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['./tests/setup/unit.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'integration',
          include: [
            'tests/integration/**/*.test.ts',
            'tests/smoke/**/*.test.ts',
          ],
          environment: 'node',
          setupFiles: ['./tests/setup/integration.ts'],
          globalSetup: ['./tests/setup/integration-global.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          maxWorkers: 2,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
