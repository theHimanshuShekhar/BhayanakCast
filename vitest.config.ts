import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    environment: "node",
    globals: true,
    testTimeout: 1000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "lcov"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.test.ts",
        "**/*.config.ts",
        ".next/**",
      ],
      all: true,
    },
    include: ["**/*.{test,spec}.{js,jsx,ts,tsx}"],
    exclude: ["node_modules", "dist", ".next"],
    reporters: ["default", "html"],
    outputFile: {
      html: "./coverage/html/index.html",
    },
  },
});
