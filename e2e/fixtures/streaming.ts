/**
 * E2E Test Fixtures and Helpers
 *
 * Shared utilities for streaming E2E tests
 */

import { test as base, Page } from "@playwright/test";

// Extend test with custom fixtures
export const test = base.extend<{
	streamerPage: Page;
	viewerPage: Page;
}>({
	// Create two pages for streamer and viewer
	streamerPage: async ({ browser }, use) => {
		const context = await browser.newContext({
			permissions: ["display-capture"],
		});
		const page = await context.newPage();
		await use(page);
		await context.close();
	},

	viewerPage: async ({ browser }, use) => {
		const context = await browser.newContext();
		const page = await context.newPage();
		await use(page);
		await context.close();
	},
});

export { expect } from "@playwright/test";

/**
 * Helper to create a room and join as streamer
 */
export async function createRoomAndJoinAsStreamer(page: Page) {
	// Navigate to home
	await page.goto("/");

	// Click "Create Room" button
	await page.click('button:has-text("Create Room")');

	// Fill room details
	await page.fill('input[name="name"]', "Test Streaming Room");
	await page.fill(
		'textarea[name="description"]',
		"E2E test room for streaming",
	);

	// Submit form
	await page.click('button[type="submit"]:has-text("Create Room")');

	// Wait for navigation to room page
	await page.waitForURL(/\/room\/.+/);

	// Verify we're in the room
	await expect(page.locator("h1")).toContainText("Test Streaming Room");
}

/**
 * Helper to join an existing room as viewer
 */
export async function joinRoomAsViewer(page: Page, roomUrl: string) {
	await page.goto(roomUrl);

	// Wait for room to load
	await page.waitForSelector("[data-testid='room-container']");
}

/**
 * Helper to start screen sharing
 */
export async function startScreenSharing(page: Page) {
	// Click start streaming button
	await page.click('button:has-text("Start Streaming")');

	// Wait for audio config modal
	await page.waitForSelector("text=Start Screen Sharing");

	// Select audio option (default is system + mic)
	await page.click('button:has-text("Share Screen")');

	// Wait for stream to start
	await page.waitForSelector("text=LIVE", { timeout: 10000 });
}

/**
 * Helper to stop screen sharing
 */
export async function stopScreenSharing(page: Page) {
	await page.click('button:has-text("Stop Sharing")');

	// Wait for stream to stop
	await page.waitForSelector("button:has-text('Start Streaming')", {
		timeout: 5000,
	});
}

/**
 * Helper to verify video element is playing
 */
export async function verifyVideoPlaying(page: Page) {
	const video = page.locator("video");
	await expect(video).toBeVisible();

	// Check if video is actually playing (currentTime > 0)
	const currentTime = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
	expect(currentTime).toBeGreaterThan(0);
}
