/**
 * Error Handling E2E Tests
 */

import { test, expect } from "@playwright/test";
import { generateUniqueRoomName } from "../utils/test-helpers";

test.describe("Error Handling", () => {
	test("shows error when trying to join non-existent room", async ({ page }) => {
		await page.goto("/room/non-existent-room-id");

		// Should show error or 404
		await expect(page.locator("text=not found")).toBeVisible();
	});

	test("handles server disconnection gracefully", async ({ page }) => {
		const roomName = generateUniqueRoomName("Disconnect Test");

		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Simulate server disconnect
		await page.evaluate(() => {
			window.dispatchEvent(new Event('offline'));
		});

		// Should show offline indicator or reconnecting message
		await expect(page.locator("text=reconnecting")).toBeVisible();
	});

	test("validates room name is required", async ({ page }) => {
		await page.goto("/");
		await page.click('button:has-text("Create Room")');

		// Try to submit empty form
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Should show validation error
		await expect(page.locator("text=required")).toBeVisible();
	});

	test("validates room name minimum length", async ({ page }) => {
		await page.goto("/");
		await page.click('button:has-text("Create Room")');

		// Enter short name
		await page.fill('input[name="name"]', "AB");
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Should show validation error
		await expect(page.locator("text=at least 3")).toBeVisible();
	});
});
