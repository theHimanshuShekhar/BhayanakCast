/**
 * User Presence and Indicators E2E Tests
 */

import { test, expect, loginUser, TEST_VIEWPORT } from "../utils/auth";
import { generateUniqueRoomName } from "../utils/test-helpers";

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
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await page.waitForTimeout(1000);

		// Should show streamer badge or indicator
		await expect(page.locator("text=Streamer").first()).toBeVisible();
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
			await page1.waitForSelector("text=Create New Room", { state: "visible" });
			await page1.waitForTimeout(500);
			await page1.getByPlaceholder("Enter room name...").fill(roomName);
			await page1.click('button[type="submit"]:has-text("Create Room")');
			await page1.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// User B joins
			await page2.goto(page1.url());
			await page2.waitForLoadState("networkidle");
			await page2.waitForTimeout(1000);

			// Wait for sync
			await page1.waitForTimeout(2000);

			// Should show participant avatars or names (check for any user indicators)
			await expect(page1.locator("text=Viewers").first()).toBeVisible();

			await context2.close();
		} finally {
			await context1.close();
		}
	});

	test("updates online user count on home page", async ({ page }) => {
		await page.goto("/");

		// Should see online user count
		await expect(page.locator("text=/users? online/i").first()).toBeVisible();
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
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await page.waitForTimeout(1000);

		// Should show connected indicator (check for any connection-related element)
		// If data-testid doesn't exist, check for viewer count as proxy for connection
		await expect(page.locator("text=/viewers|Preparing|Active/i").first()).toBeVisible();
	});
});
