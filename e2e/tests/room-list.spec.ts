/**
 * Room List and Home Page E2E Tests
 */

import { test, expect } from "@playwright/test";
import { generateUniqueRoomName } from "../utils/test-helpers";

test.describe("Room List on Home Page", () => {
	test("displays list of active rooms", async ({ page }) => {
		const roomName = generateUniqueRoomName("List Test Room");

		await page.goto("/");

		// Should see room list header
		await expect(page.locator("h2")).toContainText("Active Streams");

		// Create a room
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Go back to home
		await page.goto("/");

		// Should see the room in the list
		await expect(page.locator(`text=${roomName}`)).toBeVisible();
	});

	test("clicking room card navigates to room", async ({ page }) => {
		const roomName = generateUniqueRoomName("Clickable Room");

		// Create room first
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		const roomUrl = page.url();

		// Go back home
		await page.goto("/");

		// Click the room card
		await page.click(`text=${roomName}`);

		// Should navigate to room
		await expect(page).toHaveURL(roomUrl);
		await expect(page.locator("h1")).toContainText(roomName);
	});

	test("shows empty state when no rooms", async ({ page }) => {
		await page.goto("/");

		// Should see empty state message (if no rooms exist)
		// This depends on actual implementation
		await expect(page.locator("text=No active streams")).toBeVisible();
	});
});

test.describe("Home Page Navigation", () => {
	test("create room button opens modal", async ({ page }) => {
		await page.goto("/");

		// Click create room
		await page.click('button:has-text("Create Room")');

		// Modal should open
		await expect(page.locator("text=Create New Room")).toBeVisible();
		await expect(page.locator('input[name="name"]')).toBeVisible();
	});

	test("logo navigates to home", async ({ page }) => {
		const roomName = generateUniqueRoomName("Logo Test");

		// Create and go to room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Click logo
		await page.click("text=BhayanakCast");

		// Should navigate to home
		await expect(page).toHaveURL("/");
	});
});
