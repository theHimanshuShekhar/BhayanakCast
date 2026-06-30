import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    exclude: ['e2e/**', 'node_modules/**', '.output/**', '.worktrees/**'],
  },
})
