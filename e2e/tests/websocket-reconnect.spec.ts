/**
 * WebSocket Reconnection E2E Tests
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

test.describe("WebSocket Reconnection", () => {
	test("reconnects and rejoins room after connection loss", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Reconnect Test Room");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create and join room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Simulate disconnect by going offline
		await page.context().setOffline(true);
		await page.waitForTimeout(2000);

		// Go back online
		await page.context().setOffline(false);

		// Should automatically rejoin
		await expect(page.locator("h1")).toContainText(roomName);
	});

	test("multiple users handle reconnection", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Multi Reconnect Test");

		// Create two test users
		const user1 = await signupTestUser("User 1");
		const user2 = await signupTestUser("User 2");

		const context1 = await browser.newContext();
		const page1 = await context1.newPage();

		const context2 = await browser.newContext();
		const page2 = await context2.newPage();

		try {
			// Login both users
			await loginUser(page1, user1.email);
			await loginUser(page2, user2.email);

			// Set viewports
			await page1.setViewportSize(TEST_VIEWPORT);
			await page2.setViewportSize(TEST_VIEWPORT);
			await page1.waitForTimeout(500);
			await page2.waitForTimeout(500);

			// User 1 creates room
			await page1.locator('button:has-text("Create Room")').first().click({ force: true });
			await page1.fill('input[placeholder*="room name"]', roomName);
			await page1.click('button[type="submit"]:has-text("Create Room")');
			await page1.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// User 2 joins
			await page2.goto(page1.url());
			await page2.waitForLoadState("networkidle");
			await page2.waitForTimeout(1000);

			// Disconnect user 2
			await context2.setOffline(true);
			await page2.waitForTimeout(1000);

			// Reconnect user 2
			await context2.setOffline(false);

			// Both should see each other
			await expect(page1.locator("text=1 viewers")).toBeVisible();
			await expect(page2.locator("text=1 viewers")).toBeVisible();
		} finally {
			await context1.close();
			await context2.close();
		}
	});
});
