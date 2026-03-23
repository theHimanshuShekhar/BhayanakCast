/**
 * Screen Sharing E2E Tests
 *
 * Tests for WebRTC screen sharing functionality
 */

import { test, expect, loginUser, TEST_VIEWPORT } from "../../utils/auth";

test.describe("Screen Sharing", () => {
	test("streamer can start screen sharing", async ({ page, signupTestUser }) => {
		const user = await signupTestUser("Streamer");
		await loginUser(page, user.email);
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill("Screen Share Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await page.waitForTimeout(1000);

		// Click start streaming
		await page.click('button:has-text("Start Streaming")');
		await page.waitForTimeout(500);
		await expect(page.locator("text=Start Screen Sharing").first()).toBeVisible();
		await page.click('button:has-text("Share Screen")');

		// Wait for stream to start
		await page.waitForTimeout(5000);
		await expect(page.locator("text=LIVE").first()).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=Stop Sharing").first()).toBeVisible();
	});

	test("streamer can select different audio configurations", async ({ page, signupTestUser }) => {
		const user = await signupTestUser("Streamer");
		await loginUser(page, user.email);
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill("Audio Config Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await page.waitForTimeout(1000);

		await page.click('button:has-text("Start Streaming")');
		await page.waitForTimeout(500);
		await expect(page.locator("text=Start Screen Sharing").first()).toBeVisible();
		await page.click('text=Microphone only');
		await page.click('button:has-text("Share Screen")');

		// Wait for stream to start
		await page.waitForTimeout(5000);
		await expect(page.locator("text=LIVE").first()).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=Mic only").first()).toBeVisible();
	});

	test("streamer can stop screen sharing", async ({ page, signupTestUser }) => {
		const user = await signupTestUser("Streamer");
		await loginUser(page, user.email);
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill("Stop Stream Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await page.waitForTimeout(1000);

		await page.click('button:has-text("Start Streaming")');
		await page.waitForTimeout(500);
		await page.click('button:has-text("Share Screen")');

		// Wait for stream to start
		await page.waitForTimeout(5000);
		await expect(page.locator("text=LIVE").first()).toBeVisible({ timeout: 10000 });

		await page.click('button:has-text("Stop Sharing")');
		await page.waitForTimeout(1000);

		await expect(page.locator("button:has-text('Start Streaming')").first()).toBeVisible();
		await expect(page.locator("text=LIVE").first()).not.toBeVisible();
	});

	test("mobile user cannot start streaming", async ({ page, signupTestUser }) => {
		const user = await signupTestUser("Mobile User");
		await loginUser(page, user.email);
		await page.setViewportSize({ width: 375, height: 667 });

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill("Mobile Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await page.waitForTimeout(1000);

		const startButton = page.locator('button:has-text("Start Streaming")').first();
		await expect(startButton).toBeVisible();
		await expect(startButton).toBeDisabled();
		await expect(page.locator("text=Mobile devices cannot stream").first()).toBeVisible();
	});
});
