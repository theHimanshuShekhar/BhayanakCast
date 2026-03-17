/**
 * Error Handling E2E Tests
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

test.describe("Error Handling", () => {
	test("shows error when trying to join non-existent room", async ({ page }) => {
		await page.goto("/room/non-existent-room-id");

		// Should show error or 404
		await expect(page.locator("text=not found")).toBeVisible();
	});

	test("handles server disconnection gracefully", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Disconnect Test");

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

		// Simulate server disconnect
		await page.evaluate(() => {
			window.dispatchEvent(new Event('offline'));
		});

		// Should show offline indicator or reconnecting message
		await expect(page.locator("text=reconnecting")).toBeVisible();
	});

	test("validates room name is required", async ({ page, signupTestUser }) => {
		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Click create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });

		// Try to submit empty form
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Should show validation error
		await expect(page.locator("text=required")).toBeVisible();
	});

	test("validates room name minimum length", async ({ page, signupTestUser }) => {
		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Click create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });

		// Enter short name
		await page.fill('input[placeholder*="room name"]', "AB");
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Should show validation error
		await expect(page.locator("text=at least 3")).toBeVisible();
	});
});
