/**
 * Rate Limiting E2E Tests (Basic Sanity Checks)
 *
 * Note: Full rate limiting testing is done in unit tests.
 * These E2E tests verify basic enforcement works in production.
 */

import { test, expect } from "@playwright/test";

test.describe("Rate Limiting - Basic Enforcement", () => {
	test("prevents rapid room creation", async ({ page }) => {
		await page.goto("/");

		// Create first room
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Rate Limit Test 1");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Go back and try to create another immediately
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Rate Limit Test 2");
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Should see rate limit error
		await expect(page.locator("text=too quickly")).toBeVisible();
	});

	test("allows room creation after cooldown period", async ({ page }) => {
		await page.goto("/");

		// Create first room
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Cooldown Test 1");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Wait 60 seconds (room creation rate limit)
		await page.waitForTimeout(61000);

		// Should be able to create now
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Cooldown Test 2");
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Should succeed
		await page.waitForURL(/\/room\/.+/);
		await expect(page.locator("h1")).toContainText("Cooldown Test 2");
	});
});
