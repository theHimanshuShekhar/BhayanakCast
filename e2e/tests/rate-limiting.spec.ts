/**
 * Rate Limiting E2E Tests (Basic Sanity Checks)
 *
 * Note: Full rate limiting testing is done in unit tests.
 * These E2E tests verify basic enforcement works in production.
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
		await page.fill('input[placeholder*="room name"]', roomName1);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Go back and try to create another immediately
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName2);
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Should see rate limit error
		await expect(page.locator("text=too quickly")).toBeVisible();
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
		await page.fill('input[placeholder*="room name"]', roomName1);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Wait 60 seconds (room creation rate limit)
		await page.waitForTimeout(61000);

		// Should be able to create now
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName2);
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Should succeed
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await expect(page.locator("h1")).toContainText(roomName2);
	});
});
