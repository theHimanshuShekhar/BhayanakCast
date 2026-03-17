/**
 * Screen Sharing E2E Tests
 *
 * Tests for WebRTC screen sharing functionality
 */

import { test, expect } from "@playwright/test";

test.describe("Screen Sharing", () => {
	test("streamer can start screen sharing", async ({ page }) => {
		// Create a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Screen Share Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Click start streaming
		await page.click('button:has-text("Start Streaming")');

		// Wait for audio config modal
		await expect(page.locator("text=Start Screen Sharing")).toBeVisible();
		await expect(page.locator("text=Audio")).toBeVisible();
		await expect(page.locator("text=Show Cursor")).toBeVisible();

		// Select audio option and start
		await page.click('button:has-text("Share Screen")');

		// Wait for stream to start
		await expect(page.locator("text=LIVE")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=Stop Sharing")).toBeVisible();
	});

	test("streamer can select different audio configurations", async ({ page }) => {
		// Create a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Audio Config Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Click start streaming
		await page.click('button:has-text("Start Streaming")');

		// Wait for modal
		await expect(page.locator("text=Start Screen Sharing")).toBeVisible();

		// Select "Microphone only" option
		await page.click('text=Microphone only');

		// Start sharing
		await page.click('button:has-text("Share Screen")');

		// Verify stream started with mic only
		await expect(page.locator("text=LIVE")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=Mic only")).toBeVisible();
	});

	test("streamer can stop screen sharing", async ({ page }) => {
		// Create room and start streaming
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Stop Stream Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Start streaming
		await page.click('button:has-text("Start Streaming")');
		await page.click('button:has-text("Share Screen")');
		await expect(page.locator("text=LIVE")).toBeVisible({ timeout: 10000 });

		// Stop sharing
		await page.click('button:has-text("Stop Sharing")');

		// Verify stream stopped
		await expect(page.locator("button:has-text('Start Streaming')")).toBeVisible();
		await expect(page.locator("text=LIVE")).not.toBeVisible();
	});

	test("viewer sees stream when streamer is live", async ({ browser }) => {
		// Create streamer context
		const streamerContext = await browser.newContext({
			permissions: ["display-capture"],
		});
		const streamerPage = await streamerContext.newPage();

		// Create viewer context
		const viewerContext = await browser.newContext();
		const viewerPage = await viewerContext.newPage();

		try {
			// Streamer creates room and starts streaming
			await streamerPage.goto("/");
			await streamerPage.click('button:has-text("Create Room")');
			await streamerPage.fill('input[name="name"]', "Viewer Stream Test");
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/);
			const roomUrl = streamerPage.url();

			// Start streaming
			await streamerPage.click('button:has-text("Start Streaming")');
			await streamerPage.click('button:has-text("Share Screen")');
			await expect(streamerPage.locator("text=LIVE")).toBeVisible({ timeout: 10000 });

			// Viewer joins room
			await viewerPage.goto(roomUrl);

			// Viewer should see the stream
			await expect(viewerPage.locator("video")).toBeVisible({ timeout: 15000 });
			await expect(viewerPage.locator("text=LIVE")).toBeVisible();

		} finally {
			await streamerContext.close();
			await viewerContext.close();
		}
	});

	test("multiple viewers can watch the same stream", async ({ browser }) => {
		const streamerContext = await browser.newContext({
			permissions: ["display-capture"],
		});
		const streamerPage = await streamerContext.newPage();

		const viewer1Context = await browser.newContext();
		const viewer1Page = await viewer1Context.newPage();

		const viewer2Context = await browser.newContext();
		const viewer2Page = await viewer2Context.newPage();

		try {
			// Streamer creates room
			await streamerPage.goto("/");
			await streamerPage.click('button:has-text("Create Room")');
			await streamerPage.fill('input[name="name"]', "Multiple Viewers Test");
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/);
			const roomUrl = streamerPage.url();

			// Start streaming
			await streamerPage.click('button:has-text("Start Streaming")');
			await streamerPage.click('button:has-text("Share Screen")');
			await expect(streamerPage.locator("text=LIVE")).toBeVisible({ timeout: 10000 });

			// Two viewers join
			await viewer1Page.goto(roomUrl);
			await viewer2Page.goto(roomUrl);

			// Both viewers should see the stream
			await expect(viewer1Page.locator("video")).toBeVisible({ timeout: 15000 });
			await expect(viewer2Page.locator("video")).toBeVisible({ timeout: 15000 });

			// Verify viewer count
			await expect(streamerPage.locator("text=2 viewers")).toBeVisible();

		} finally {
			await streamerContext.close();
			await viewer1Context.close();
			await viewer2Context.close();
		}
	});

	test("mobile user cannot start streaming", async ({ page }) => {
		// Set mobile viewport
		await page.setViewportSize({ width: 375, height: 667 });

		// Create room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Mobile Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Check that streaming button is disabled or shows mobile message
		const startButton = page.locator('button:has-text("Start Streaming")');
		await expect(startButton).toBeVisible();
		
		// Button should be disabled for mobile
		await expect(startButton).toBeDisabled();
		
		// Should show mobile restriction message
		await expect(page.locator("text=Mobile devices cannot stream")).toBeVisible();
	});
});
