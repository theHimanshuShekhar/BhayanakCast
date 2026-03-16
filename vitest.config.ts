import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { config } from "dotenv";

// Load .env.local for tests
config({ path: ".env.local" });

export default defineConfig({
	plugins: [react(), tsconfigPaths()],
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./tests/setup.ts"],
		// Run tests sequentially to avoid database transaction conflicts
		pool: "threads",
		poolOptions: {
			threads: {
				singleThread: true,
			},
		},
		// Disable parallel execution for integration tests
		fileParallelism: false,
		coverage: {
			provider: "v8",
			reporter: ["text", "text-summary"],
			thresholds: {
				statements: 90,
				branches: 90,
				functions: 90,
				lines: 90,
			},
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.d.ts",
				"src/**/routeTree.gen.ts",
				"src/test/**/*",
				"tests/**/*",
			],
		},
		maxConcurrency: 10,
		hookTimeout: 30000,
		testTimeout: 10000,
	},
	resolve: {
		alias: {
			"#": "/src",
		},
	},
});
