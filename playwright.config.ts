/**
 * Playwright Configuration
 *
 * E2E testing for BhayanakCast WebRTC streaming
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e/tests",
	fullyParallel: false, // WebRTC tests need to run sequentially
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 1,
	workers: 1, // WebRTC requires single worker for proper peer connections
	reporter: [
		["list"],
		["html", { open: "never" }],
	],
	use: {
		baseURL: process.env.BASE_URL || "http://localhost:3000",
		trace: "on-first-retry",
		video: "on-first-retry",
		screenshot: "only-on-failure",
		// Grant permissions for screen sharing
		permissions: ["display-capture"],
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				// Enable fake media devices for testing
				launchOptions: {
					args: [
						"--use-fake-device-for-media-stream",
						"--use-fake-ui-for-media-stream",
						"--auto-select-desktop-capture-source=Entire screen",
						"--enable-features=WebRtcHideLocalIpsWithMdns",
					],
				},
			},
		},
		{
			name: "chromium-streamer",
			use: {
				...devices["Desktop Chrome"],
				launchOptions: {
					args: [
						"--use-fake-device-for-media-stream",
						"--use-fake-ui-for-media-stream",
						"--auto-select-desktop-capture-source=Entire screen",
					],
				},
			},
			testMatch: /streaming\/.*\.spec\.ts/,
		},
	],
	webServer: {
		command: "pnpm dev",
		url: "http://localhost:3000",
		reuseExistingServer: !process.env.CI,
		timeout: 120000,
	},
	timeout: 60000,
	expect: {
		timeout: 10000,
	},
});
