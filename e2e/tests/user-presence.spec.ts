/**
 * User Presence and Indicators E2E Tests
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

test.describe("User Presence Indicators", () => {
	test("shows streamer indicator when user is streamer", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Streamer Indicator Test");

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

		// Should show streamer badge or indicator
		await expect(page.locator("text=Streamer")).toBeVisible();
	});

	test("shows participant list with usernames", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Participant List Test");

		// Create two test users
		const userA = await signupTestUser("User A");
		const userB = await signupTestUser("User B");

		const context1 = await browser.newContext();
		const page1 = await context1.newPage();

		try {
			// Login both users
			await loginUser(page1, userA.email);

			const context2 = await browser.newContext();
			const page2 = await context2.newPage();

			await loginUser(page2, userB.email);

			// Set viewports
			await page1.setViewportSize(TEST_VIEWPORT);
			await page2.setViewportSize(TEST_VIEWPORT);
			await page1.waitForTimeout(500);
			await page2.waitForTimeout(500);

			// User A creates room
			await page1.locator('button:has-text("Create Room")').first().click({ force: true });
			await page1.fill('input[placeholder*="room name"]', roomName);
			await page1.click('button[type="submit"]:has-text("Create Room")');
			await page1.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// User B joins
			await page2.goto(page1.url());
			await page2.waitForLoadState("networkidle");
			await page2.waitForTimeout(1000);

			// Should show participant avatars or names
			await expect(page1.locator("[data-testid='participant-avatar']")).toHaveCount(2);

			await context2.close();
		} finally {
			await context1.close();
		}
	});

	test("updates online user count on home page", async ({ page }) => {
		await page.goto("/");

		// Should see online user count
		await expect(page.locator("text=online")).toBeVisible();
	});
});

test.describe("Connection Status", () => {
	test("shows connection status indicator", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Connection Test");

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

		// Should show connected indicator
		await expect(page.locator("[data-testid='connection-status']")).toBeVisible();
	});
});
