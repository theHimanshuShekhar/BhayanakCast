import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts: these tests need Docker (a real Postgres, to hold an advisory
// lock against a second runner), so `pnpm test` stays Docker-free. Run with `pnpm test:migrate`.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.docker.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
