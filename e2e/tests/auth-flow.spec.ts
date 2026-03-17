/**
 * Example E2E Test with Test Authentication
 * 
 * This demonstrates how to use the test auth utilities to create
 * multiple test users for scenarios like streamer + viewer interactions.
 */

import { test, expect } from "../utils/auth";
import { generateUniqueRoomName } from "../utils/test-helpers";

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

test.describe("Example: Streamer and Viewer Test Flow", () => {
	test("streamer can create room and viewer can join", async ({
		browser,
		signupTestUser,
	}) => {
		// Create two test users
		const streamer = await signupTestUser("Test Streamer");
		const viewer = await signupTestUser("Test Viewer");

		console.log(`[Test] Created streamer: ${streamer.email}`);
		console.log(`[Test] Created viewer: ${viewer.email}`);

		// Create contexts and pages
		const streamerContext = await browser.newContext();
		const viewerContext = await browser.newContext();

		const streamerPage = await streamerContext.newPage();
		const viewerPage = await viewerContext.newPage();

		try {
			// Login both users via UI
			await loginUser(streamerPage, streamer.email);
			await loginUser(viewerPage, viewer.email);

			// Set viewports after login
			await streamerPage.setViewportSize(TEST_VIEWPORT);
			await viewerPage.setViewportSize(TEST_VIEWPORT);
			await streamerPage.waitForTimeout(500);
			await viewerPage.waitForTimeout(500);

			// Streamer creates a room
			await streamerPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await streamerPage.fill('input[placeholder*="room name"]', "Test Stream Room");
			await streamerPage.fill('textarea[name="description"]', "A test room for E2E testing");
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

			const roomUrl = streamerPage.url();
			console.log(`[Test] Room created: ${roomUrl}`);

			// Verify streamer is in the room
			await expect(streamerPage.locator("h1")).toContainText("Test Stream Room");

			// Viewer joins the room
			await viewerPage.goto(roomUrl);
			await viewerPage.waitForLoadState("networkidle");
			await viewerPage.waitForTimeout(1000);

			// Verify viewer is also in the room
			await expect(viewerPage.locator("h1")).toContainText("Test Stream Room");

			// Verify both users see each other (wait for websocket to sync)
			await streamerPage.waitForTimeout(2000);
			await expect(streamerPage.locator("text=/\\d+ viewers?/")).toBeVisible();
			await expect(viewerPage.locator("text=/\\d+ viewers?/")).toBeVisible();

			console.log("[Test] Both users successfully joined the room!");
		} finally {
			// Cleanup contexts
			await streamerContext.close();
			await viewerContext.close();
		}
	});

	test("multiple viewers can join a stream", async ({ browser, signupTestUser }) => {
		// Create streamer and multiple viewers
		const streamer = await signupTestUser("Streamer");
		const viewer1 = await signupTestUser("Viewer1");
		const viewer2 = await signupTestUser("Viewer2");

		// Create contexts
		const streamerCtx = await browser.newContext();
		const viewer1Ctx = await browser.newContext();
		const viewer2Ctx = await browser.newContext();

		const streamerPage = await streamerCtx.newPage();
		const viewer1Page = await viewer1Ctx.newPage();
		const viewer2Page = await viewer2Ctx.newPage();

		try {
			// Login all users
			await loginUser(streamerPage, streamer.email);
			await loginUser(viewer1Page, viewer1.email);
			await loginUser(viewer2Page, viewer2.email);

			// Set viewports
			await streamerPage.setViewportSize(TEST_VIEWPORT);
			await viewer1Page.setViewportSize(TEST_VIEWPORT);
			await viewer2Page.setViewportSize(TEST_VIEWPORT);
			await streamerPage.waitForTimeout(500);
			await viewer1Page.waitForTimeout(500);
			await viewer2Page.waitForTimeout(500);

			// Streamer creates room
			await streamerPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await streamerPage.fill('input[placeholder*="room name"]', "Multi Viewer Test");
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

			const roomUrl = streamerPage.url();

			// Both viewers join
			await viewer1Page.goto(roomUrl);
			await viewer2Page.goto(roomUrl);
			await viewer1Page.waitForLoadState("networkidle");
			await viewer2Page.waitForLoadState("networkidle");
			await viewer1Page.waitForTimeout(1000);
			await viewer2Page.waitForTimeout(1000);

			// Verify all see viewer count (wait for websocket to sync)
			await streamerPage.waitForTimeout(2000);
			await expect(streamerPage.locator("text=/\\d+ viewers?/")).toBeVisible();
			await expect(viewer1Page.locator("text=/\\d+ viewers?/")).toBeVisible();
			await expect(viewer2Page.locator("text=/\\d+ viewers?/")).toBeVisible();

			console.log("[Test] Multi-viewer test passed!");
		} finally {
			// Cleanup
			await streamerCtx.close();
			await viewer1Ctx.close();
			await viewer2Ctx.close();
		}
	});
});
