import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { config } from "dotenv";

// Load .env.local for tests
config({ path: ".env.local" });

// Override DATABASE_URL to use test database
const originalDbUrl = process.env.DATABASE_URL ||
	"postgresql://postgres:postgres@localhost:5432/postgres";
const testDbUrl = originalDbUrl.replace(/\/[^/]+$/, "/bhayanak_cast_test");
process.env.DATABASE_URL = testDbUrl;
console.log(`[Vitest Config] Using test database: ${testDbUrl}`);

export default defineConfig({
	plugins: [react(), tsconfigPaths()],
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./tests/setup.ts"],
		// Exclude E2E tests from Vitest (run by Playwright separately)
		exclude: ["e2e/**/*", "node_modules/**/*"],
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
				// Type definition files
				"src/**/*.d.ts",
				"src/**/routeTree.gen.ts",
				// Route files are SSR/server hybrids — covered by E2E tests, not unit tests
				"src/routes/**/*",
				// Server utility functions — covered by E2E/integration tests
				"src/utils/**/*",
				// Database layer — covered by integration tests
				"src/db/**/*",
				// Third-party integration provider wrappers (no internal logic to test)
				"src/integrations/**/*",
				// App router and env config — thin framework wrappers with no testable logic
				"src/router.tsx",
				"src/env.ts",
				// Thin config wrappers with no testable logic
				"src/lib/auth.ts",
				"src/lib/auth-client.ts",
				"src/lib/auth-guard.ts",
				"src/lib/site.ts",
				"src/lib/webrtc-config.ts",
				// Pure type definitions
				"src/types/webrtc.ts",
				// Components that depend on third-party auth UI (UserButton, useAuthenticate)
				// or server functions with dynamic imports — covered by E2E tests
				"src/components/AuthGuard.tsx",
				"src/components/Header.tsx",
				"src/components/UserStatsCard.tsx",
				"src/components/TopConnectionsCard.tsx",
				"src/components/ActiveRoomIndicator.tsx",
				// Test helpers
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
