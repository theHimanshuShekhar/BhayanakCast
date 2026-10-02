import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // Need Docker: `pnpm test:migrate`.
    exclude: [...configDefaults.exclude, "src/**/*.docker.test.ts"],
    // Each DB test file boots and migrates its own in-process PGlite; too many at once starve
    // the CPU and first hooks time out. Cap parallelism and give setup room on a loaded machine.
    // Boot in `beforeEach`, not in the test body: only the hook gets `hookTimeout`.
    maxWorkers: 4,
    hookTimeout: 30_000,
    // Realtime tests wait on real sockets for up to 10 s per message (the harness's
    // DEFAULT_TIMEOUT_MS), so a test has to outlast one such wait, and so does `expect.poll`.
    testTimeout: 30_000,
    expect: { poll: { timeout: 10_000 } },
  },
});
