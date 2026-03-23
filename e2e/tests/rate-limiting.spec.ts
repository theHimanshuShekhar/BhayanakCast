/**
 * Rate Limiting E2E Tests (Basic Sanity Checks)
 *
 * Note: Full rate limiting testing is done in unit tests.
 * These E2E tests verify basic enforcement works in production.
 */

import { test, expect, loginUser, TEST_VIEWPORT } from "../utils/auth";
import { generateUniqueRoomName } from "../utils/test-helpers";

test.describe("Rate Limiting - Basic Enforcement", () => {
	test("prevents rapid room creation", async ({ page, signupTestUser }) => {
		const roomName1 = generateUniqueRoomName("Rate Limit Test 1");
		const roomName2 = generateUniqueRoomName("Rate Limit Test 2");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create first room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName1);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Go back and try to create another immediately
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName2);
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Should see rate limit error (flexible matching)
		await expect(page.locator("text=/too quickly|rate limit|try again/i").first()).toBeVisible();
	});

	test("allows room creation after cooldown period", async ({ page, signupTestUser }) => {
		const roomName1 = generateUniqueRoomName("Cooldown Test 1");
		const roomName2 = generateUniqueRoomName("Cooldown Test 2");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create first room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName1);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Wait 65 seconds (room creation rate limit is 60s)
		await page.waitForTimeout(65000);

		// Should be able to create now
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName2);
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Should succeed
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await expect(page.locator("h1")).toBeVisible();
	});
});
