/**
 * User Presence and Indicators E2E Tests
 */

import { test, expect } from "@playwright/test";
import { generateUniqueRoomName } from "../utils/test-helpers";

test.describe("User Presence Indicators", () => {
	test("shows streamer indicator when user is streamer", async ({ page }) => {
		const roomName = generateUniqueRoomName("Streamer Indicator Test");

		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Should show streamer badge or indicator
		await expect(page.locator("text=Streamer")).toBeVisible();
	});

	test("shows participant list with usernames", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Participant List Test");
		const context1 = await browser.newContext();
		const page1 = await context1.newPage();

		await page1.goto("/");
		await page1.click('button:has-text("Create Room")');
		await page1.fill('input[name="name"]', roomName);
		await page1.click('button[type="submit"]:has-text("Create Room")');
		await page1.waitForURL(/\/room\/.+/);

		const context2 = await browser.newContext();
		const page2 = await context2.newPage();
		await page2.goto(page1.url());

		// Should show participant avatars or names
		await expect(page1.locator("[data-testid='participant-avatar']")).toHaveCount(2);

		await context1.close();
		await context2.close();
	});

	test("updates online user count on home page", async ({ page }) => {
		await page.goto("/");

		// Should see online user count
		await expect(page.locator("text=online")).toBeVisible();
	});
});

test.describe("Connection Status", () => {
	test("shows connection status indicator", async ({ page }) => {
		const roomName = generateUniqueRoomName("Connection Test");

		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Should show connected indicator
		await expect(page.locator("[data-testid='connection-status']")).toBeVisible();
	});
});
