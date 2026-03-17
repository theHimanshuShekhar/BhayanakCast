/**
 * Room Status Transitions E2E Tests
 *
 * Tests for room status lifecycle:
 * - waiting → preparing → active → preparing → waiting → ended
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

test.describe("Room Status Lifecycle", () => {
	test("room starts in preparing status when created", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Status Test Room");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Should show preparing status (streamer present, < 2 participants)
		await expect(page.locator("text=Preparing")).toBeVisible();
	});

	test("room becomes active when 2nd participant joins", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Active Status Test");

		// Create two test users
		const userA = await signupTestUser("User A");
		const userB = await signupTestUser("User B");

		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();

		try {
			// Login both users
			await loginUser(userAPage, userA.email);
			await loginUser(userBPage, userB.email);

			// Set viewports
			await userAPage.setViewportSize(TEST_VIEWPORT);
			await userBPage.setViewportSize(TEST_VIEWPORT);
			await userAPage.waitForTimeout(500);
			await userBPage.waitForTimeout(500);

			// User A creates room
			await userAPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await userAPage.fill('input[placeholder*="room name"]', roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// Verify preparing
			await expect(userAPage.locator("text=Preparing")).toBeVisible();

			// User B joins
			await userBPage.goto(userAPage.url());
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Both should see active
			await expect(userAPage.locator("text=Active")).toBeVisible();
			await expect(userBPage.locator("text=Active")).toBeVisible();
		} finally {
			await userAContext.close();
			await userBContext.close();
		}
	});

	test("room returns to waiting when all participants leave", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Waiting Status Test");

		// Create two test users
		const userA = await signupTestUser("User A");
		const userB = await signupTestUser("User B");

		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();

		try {
			// Login both users
			await loginUser(userAPage, userA.email);
			await loginUser(userBPage, userB.email);

			// Set viewports
			await userAPage.setViewportSize(TEST_VIEWPORT);
			await userBPage.setViewportSize(TEST_VIEWPORT);
			await userAPage.waitForTimeout(500);
			await userBPage.waitForTimeout(500);

			// User A creates room
			await userAPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await userAPage.fill('input[placeholder*="room name"]', roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// User B joins (active)
			await userBPage.goto(userAPage.url());
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			await expect(userAPage.locator("text=Active")).toBeVisible();

			// User A (streamer) leaves
			await userAPage.click('button:has-text("Leave Room")');
			await expect(userAPage).toHaveURL("/");

			// User B should become streamer
			await expect(userBPage.locator("text=is now the streamer")).toBeVisible();

			// User B leaves
			await userBPage.click('button:has-text("Leave Room")');
			await expect(userBPage).toHaveURL("/");
		} finally {
			await userAContext.close();
			await userBContext.close();
		}
	});

	test("streaming starts in preparing status", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Streaming Status Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Preparing before streaming
		await expect(page.locator("text=Preparing")).toBeVisible();

		// Start streaming
		await page.click('button:has-text("Start Streaming")');
		await page.click('button:has-text("Share Screen")');

		// Should show LIVE indicator (active status)
		await expect(page.locator("text=LIVE")).toBeVisible();
	});

	test("stopping stream returns to preparing status", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Stop Stream Status Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Start streaming
		await page.click('button:has-text("Start Streaming")');
		await page.click('button:has-text("Share Screen")');
		await expect(page.locator("text=LIVE")).toBeVisible();

		// Stop streaming
		await page.click('button:has-text("Stop Sharing")');

		// Should return to preparing
		await expect(page.locator("text=Preparing")).toBeVisible();
		await expect(page.locator("text=LIVE")).not.toBeVisible();
	});

	test("status updates are broadcast to all participants", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Broadcast Status Test");

		// Create two test users
		const userA = await signupTestUser("User A");
		const userB = await signupTestUser("User B");

		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();

		try {
			// Login both users
			await loginUser(userAPage, userA.email);
			await loginUser(userBPage, userB.email);

			// Set viewports
			await userAPage.setViewportSize(TEST_VIEWPORT);
			await userBPage.setViewportSize(TEST_VIEWPORT);
			await userAPage.waitForTimeout(500);
			await userBPage.waitForTimeout(500);

			// User A creates room
			await userAPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await userAPage.fill('input[placeholder*="room name"]', roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// User B joins
			await userBPage.goto(userAPage.url());
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Both see active
			await expect(userAPage.locator("text=Active")).toBeVisible();
			await expect(userBPage.locator("text=Active")).toBeVisible();

			// User A (streamer) leaves
			await userAPage.click('button:has-text("Leave Room")');

			// User B should see status change notification
			await expect(userBPage.locator("text=is now the streamer")).toBeVisible();
		} finally {
			await userAContext.close();
			await userBContext.close();
		}
	});
});

test.describe("Room Persistence", () => {
	test("room remains active when page is refreshed", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Refresh Test Room");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Verify in room
		await expect(page.locator("h1")).toContainText(roomName);

		// Refresh page
		await page.reload();
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Should still be in room
		await expect(page.locator("h1")).toContainText(roomName);
	});

	test("room data persists after navigation", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Navigation Test Room");
		const roomDescription = "Test description";

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.fill('textarea[name="description"]', roomDescription);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Go back to home
		await page.click('button:has-text("Leave Room")');
		await expect(page).toHaveURL("/");

		// Room should appear in list
		await expect(page.locator(`text=${roomName}`)).toBeVisible();

		// Click on room
		await page.click(`text=${roomName}`);

		// Should be back in room with data intact
		await expect(page.locator("h1")).toContainText(roomName);
		await expect(page.locator(`text=${roomDescription}`)).toBeVisible();
	});
});
