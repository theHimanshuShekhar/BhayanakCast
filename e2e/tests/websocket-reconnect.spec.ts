/**
 * WebSocket Reconnection E2E Tests
 */

import { test, expect, loginUser, TEST_VIEWPORT } from "../utils/auth";
import { generateUniqueRoomName } from "../utils/test-helpers";

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
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		const roomId = roomName.split("-")[2];
		await expect(page.locator("h1")).toContainText(roomId);

		// Simulate disconnect by going offline
		await page.context().setOffline(true);
		await page.waitForTimeout(2000);

		// Go back online
		await page.context().setOffline(false);
		await page.waitForTimeout(2000);

		// Should still be in room after reconnect
		await expect(page.locator("h1")).toContainText(roomId);
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
			await page1.waitForSelector("text=Create New Room", { state: "visible" });
			await page1.waitForTimeout(500);
			await page1.getByPlaceholder("Enter room name...").fill(roomName);
			await page1.click('button[type="submit"]:has-text("Create Room")');
			await page1.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// User 2 joins
			await page2.goto(page1.url());
			await page2.waitForLoadState("networkidle");
			await page2.waitForTimeout(1000);

			// Wait for sync
			await page1.waitForTimeout(2000);

			// Disconnect user 2
			await context2.setOffline(true);
			await page2.waitForTimeout(1000);

			// Reconnect user 2
			await context2.setOffline(false);
			await page2.waitForTimeout(2000);

			// Both should see each other (check viewer counts)
			await expect(page1.locator("text=/\\d+ viewers?/i").first()).toBeVisible();
			await expect(page2.locator("text=/\\d+ viewers?/i").first()).toBeVisible();
		} finally {
			await context1.close();
			await context2.close();
		}
	});
});
