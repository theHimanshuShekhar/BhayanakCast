/**
 * Streamer Transfer E2E Tests
 *
 * Tests for automatic and manual streamer transfer
 */

import { test, expect } from "../../utils/auth";
import { generateUniqueRoomName } from "../../utils/test-helpers";

// Viewport where Create Room button is visible (< 1280px due to xl:hidden)
const TEST_VIEWPORT = { width: 1200, height: 800 };

// Helper to login via UI
async function loginUser(page: any, email: string) {
	await page.goto("/auth/sign-in");
	await page.waitForLoadState("networkidle");
	await page.waitForTimeout(1000);

	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', "testpassword123");
	await page.click('button[type="submit"]');

	await page.waitForURL("http://localhost:3000/", { timeout: 10000 });
	await page.waitForLoadState("networkidle");
	await page.waitForTimeout(1000);
}

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

			// Streamer creates room and starts streaming
			await streamerPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await streamerPage.fill('input[placeholder*="room name"]', "Transfer Test Room");
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = streamerPage.url();

			// Start streaming
			await streamerPage.click('button:has-text("Start Streaming")');
			await streamerPage.click('button:has-text("Share Screen")');
			await expect(streamerPage.locator("text=LIVE")).toBeVisible({ timeout: 10000 });

			// Viewer joins
			await viewerPage.goto(roomUrl);
			await viewerPage.waitForLoadState("networkidle");
			await viewerPage.waitForTimeout(1000);

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
			await desktopPage.fill('input[placeholder*="room name"]', "Waiting State Test");
			await desktopPage.click('button[type="submit"]:has-text("Create Room")');
			await desktopPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = desktopPage.url();

			// Mobile user joins
			await mobilePage.goto(roomUrl);
			await mobilePage.waitForLoadState("networkidle");
			await mobilePage.waitForTimeout(1000);

			// Desktop user leaves
			await desktopPage.click('button:has-text("Leave Room")');

			// Mobile user should see waiting state
			await expect(mobilePage.locator("text=Waiting")).toBeVisible();
		} finally {
			await desktopContext.close();
			await mobileContext.close();
		}
	});
});
