import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts: these tests need Docker (a real Postgres: an advisory lock held
// against a second runner, the postgres-js driver, migrations over existing data), so `pnpm test`
// stays Docker-free. Run with `pnpm test:migrate`.
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
