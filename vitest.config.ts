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
    maxWorkers: 4,
    hookTimeout: 30_000,
  },
});
