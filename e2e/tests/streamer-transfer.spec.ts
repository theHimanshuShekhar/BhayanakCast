/**
 * Streamer Transfer E2E Tests
 *
 * Tests for automatic and manual streamer transfer
 */

import { test, expect } from "@playwright/test";

test.describe("Streamer Transfer", () => {
	test("automatic transfer when streamer leaves", async ({ browser }) => {
		const streamerContext = await browser.newContext({
			permissions: ["display-capture"],
		});
		const streamerPage = await streamerContext.newPage();

		const viewerContext = await browser.newContext();
		const viewerPage = await viewerContext.newPage();

		try {
			// Streamer creates room and starts streaming
			await streamerPage.goto("/");
			await streamerPage.click('button:has-text("Create Room")');
			await streamerPage.fill('input[name="name"]', "Transfer Test Room");
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/);
			const roomUrl = streamerPage.url();

			// Start streaming
			await streamerPage.click('button:has-text("Start Streaming")');
			await streamerPage.click('button:has-text("Share Screen")');
			await expect(streamerPage.locator("text=LIVE")).toBeVisible({ timeout: 10000 });

			// Viewer joins
			await viewerPage.goto(roomUrl);
			await expect(viewerPage.locator("video")).toBeVisible({ timeout: 15000 });

			// Streamer leaves
			await streamerPage.click('button:has-text("Leave Room")');
			await expect(streamerPage).toHaveURL("/");

			// Viewer should become streamer
			await expect(viewerPage.locator("button:has-text('Start Streaming')")).toBeVisible();
			await expect(viewerPage.locator("text=is now the streamer")).toBeVisible();

		} finally {
			await streamerContext.close();
			await viewerContext.close();
		}
	});

	test("manual streamer transfer to viewer", async ({ browser }) => {
		const streamerContext = await browser.newContext({
			permissions: ["display-capture"],
		});
		const streamerPage = await streamerContext.newPage();

		const viewerContext = await browser.newContext();
		const viewerPage = await viewerContext.newPage();

		try {
			// Streamer creates room
			await streamerPage.goto("/");
			await streamerPage.click('button:has-text("Create Room")');
			await streamerPage.fill('input[name="name"]', "Manual Transfer Test");
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/);
			const roomUrl = streamerPage.url();

			// Viewer joins
			await viewerPage.goto(roomUrl);
			await expect(viewerPage.locator("text=Manual Transfer Test")).toBeVisible();

			// Streamer initiates transfer
			await streamerPage.click('button:has-text("Transfer Streamer")');

			// Select viewer to transfer to
			await streamerPage.click(`text=${await viewerPage.evaluate(() => document.title)}`);

			// Verify transfer
			await expect(streamerPage.locator("text=is now the streamer")).toBeVisible();
			await expect(viewerPage.locator("button:has-text('Start Streaming')")).toBeVisible();

		} finally {
			await streamerContext.close();
			await viewerContext.close();
		}
	});

	test("streamer transfer cooldown prevents rapid transfers", async ({ browser }) => {
		const streamerContext = await browser.newContext({
			permissions: ["display-capture"],
		});
		const streamerPage = await streamerContext.newPage();

		const viewerContext = await browser.newContext();
		const viewerPage = await viewerContext.newPage();

		try {
			// Setup room
			await streamerPage.goto("/");
			await streamerPage.click('button:has-text("Create Room")');
			await streamerPage.fill('input[name="name"]', "Cooldown Test");
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/);
			const roomUrl = streamerPage.url();

			await viewerPage.goto(roomUrl);

			// First transfer
			await streamerPage.click('button:has-text("Transfer Streamer")');
			await streamerPage.click(`text=${await viewerPage.evaluate(() => document.title)}`);
			await expect(streamerPage.locator("text=is now the streamer")).toBeVisible();

			// Try second transfer immediately
			await streamerPage.click('button:has-text("Transfer Streamer")');
			
			// Should show cooldown message
			await expect(streamerPage.locator("text=cooldown")).toBeVisible();

		} finally {
			await streamerContext.close();
			await viewerContext.close();
		}
	});

	test("room enters waiting state when all desktop users leave", async ({ browser }) => {
		const streamerContext = await browser.newContext({
			permissions: ["display-capture"],
		});
		const streamerPage = await streamerContext.newPage();

		const mobileContext = await browser.newContext({
			viewport: { width: 375, height: 667 },
		});
		const mobilePage = await mobileContext.newPage();

		try {
			// Desktop user creates room
			await streamerPage.goto("/");
			await streamerPage.click('button:has-text("Create Room")');
			await streamerPage.fill('input[name="name"]', "Waiting State Test");
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/);
			const roomUrl = streamerPage.url();

			// Mobile user joins
			await mobilePage.goto(roomUrl);

			// Desktop user leaves
			await streamerPage.click('button:has-text("Leave Room")');

			// Mobile user should see waiting state
			await expect(mobilePage.locator("text=waiting for desktop user")).toBeVisible();

		} finally {
			await streamerContext.close();
			await mobileContext.close();
		}
	});
});
