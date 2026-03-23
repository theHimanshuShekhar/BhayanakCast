/**
 * Streamer Transfer E2E Tests
 *
 * Tests for automatic and manual streamer transfer
 */

import { test, expect, loginUser, TEST_VIEWPORT } from "../../utils/auth";

test.describe("Streamer Transfer", () => {
	test("automatic transfer when streamer leaves", async ({ browser, signupTestUser }) => {
		// Create test users
		const streamer = await signupTestUser("Streamer");
		const viewer = await signupTestUser("Viewer");

		const streamerContext = await browser.newContext({
			permissions: ["display-capture"],
		});
		const streamerPage = await streamerContext.newPage();

		const viewerContext = await browser.newContext();
		const viewerPage = await viewerContext.newPage();

		try {
			// Login both users
			await loginUser(streamerPage, streamer.email);
			await loginUser(viewerPage, viewer.email);

			// Set viewports
			await streamerPage.setViewportSize(TEST_VIEWPORT);
			await viewerPage.setViewportSize(TEST_VIEWPORT);
			await streamerPage.waitForTimeout(500);
			await viewerPage.waitForTimeout(500);

			// Streamer creates room
			await streamerPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await streamerPage.waitForSelector("text=Create New Room", { state: "visible" });
			await streamerPage.waitForTimeout(500);
			await streamerPage.getByPlaceholder("Enter room name...").fill("Transfer Test Room");
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = streamerPage.url();

			// Start streaming
			await streamerPage.click('button:has-text("Start Streaming")');
			await streamerPage.waitForTimeout(500);
			await streamerPage.click('button:has-text("Share Screen")');

			// Wait for stream to start
			await streamerPage.waitForTimeout(5000);
			await expect(streamerPage.locator("text=LIVE").first()).toBeVisible({ timeout: 10000 });

			// Viewer joins
			await viewerPage.goto(roomUrl);
			await viewerPage.waitForLoadState("networkidle");
			await viewerPage.waitForTimeout(1000);

			// Streamer leaves using back button
			await streamerPage.getByRole("button", { name: /Back to rooms/i }).click();
			await expect(streamerPage).toHaveURL("/");

			// Wait for transfer
			await viewerPage.waitForTimeout(3000);

			// Viewer should become streamer
			await expect(viewerPage.locator("button:has-text('Start Streaming')").first()).toBeVisible();
			await expect(viewerPage.locator("text=/now the streamer/i").first()).toBeVisible();
		} finally {
			await streamerContext.close();
			await viewerContext.close();
		}
	});

	test("room enters waiting state when all desktop users leave", async ({ browser, signupTestUser }) => {
		// Create test users
		const desktopUser = await signupTestUser("Desktop User");
		const mobileUser = await signupTestUser("Mobile User");

		const desktopContext = await browser.newContext({
			permissions: ["display-capture"],
		});
		const desktopPage = await desktopContext.newPage();

		const mobileContext = await browser.newContext({
			viewport: { width: 375, height: 667 },
		});
		const mobilePage = await mobileContext.newPage();

		try {
			// Login both users
			await loginUser(desktopPage, desktopUser.email);
			await loginUser(mobilePage, mobileUser.email);

			// Set desktop viewport
			await desktopPage.setViewportSize(TEST_VIEWPORT);
			await desktopPage.waitForTimeout(500);

			// Desktop user creates room
			await desktopPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await desktopPage.waitForSelector("text=Create New Room", { state: "visible" });
			await desktopPage.waitForTimeout(500);
			await desktopPage.getByPlaceholder("Enter room name...").fill("Waiting State Test");
			await desktopPage.click('button[type="submit"]:has-text("Create Room")');
			await desktopPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = desktopPage.url();

			// Mobile user joins
			await mobilePage.goto(roomUrl);
			await mobilePage.waitForLoadState("networkidle");
			await mobilePage.waitForTimeout(1000);

			// Desktop user leaves using back button
			await desktopPage.getByRole("button", { name: /Back to rooms/i }).click();
			await desktopPage.waitForTimeout(2000);

			// Mobile user should see waiting state
			await expect(mobilePage.locator("text=/Waiting|waiting/i").first()).toBeVisible();
		} finally {
			await desktopContext.close();
			await mobileContext.close();
		}
	});
});
