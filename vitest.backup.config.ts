import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts: these tests need Docker (they run backup/ scripts in their image),
// so `pnpm test` stays Docker-free. Run with `pnpm test:backup`.
export default defineConfig({
  test: {
    include: ["backup/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 600_000,
  },
});
