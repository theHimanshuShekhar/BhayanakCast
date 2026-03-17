/**
 * Screen Sharing E2E Tests
 *
 * Tests for WebRTC screen sharing functionality
 */

import { test, expect } from "../../utils/auth";
import { generateUniqueRoomName } from "../../utils/test-helpers";

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

test.describe("Screen Sharing", () => {
	test("streamer can start screen sharing", async ({ page, signupTestUser }) => {
		const user = await signupTestUser("Streamer");
		await loginUser(page, user.email);
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', "Screen Share Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		await page.click('button:has-text("Start Streaming")');
		await expect(page.locator("text=Start Screen Sharing")).toBeVisible();
		await page.click('button:has-text("Share Screen")');
		await expect(page.locator("text=LIVE")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=Stop Sharing")).toBeVisible();
	});

	test("streamer can select different audio configurations", async ({ page, signupTestUser }) => {
		const user = await signupTestUser("Streamer");
		await loginUser(page, user.email);
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', "Audio Config Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		await page.click('button:has-text("Start Streaming")');
		await expect(page.locator("text=Start Screen Sharing")).toBeVisible();
		await page.click('text=Microphone only');
		await page.click('button:has-text("Share Screen")');
		await expect(page.locator("text=LIVE")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=Mic only")).toBeVisible();
	});

	test("streamer can stop screen sharing", async ({ page, signupTestUser }) => {
		const user = await signupTestUser("Streamer");
		await loginUser(page, user.email);
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', "Stop Stream Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		await page.click('button:has-text("Start Streaming")');
		await page.click('button:has-text("Share Screen")');
		await expect(page.locator("text=LIVE")).toBeVisible({ timeout: 10000 });

		await page.click('button:has-text("Stop Sharing")');
		await expect(page.locator("button:has-text('Start Streaming')")).toBeVisible();
		await expect(page.locator("text=LIVE")).not.toBeVisible();
	});

	test("mobile user cannot start streaming", async ({ page, signupTestUser }) => {
		const user = await signupTestUser("Mobile User");
		await loginUser(page, user.email);
		await page.setViewportSize({ width: 375, height: 667 });

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', "Mobile Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		const startButton = page.locator('button:has-text("Start Streaming")');
		await expect(startButton).toBeVisible();
		await expect(startButton).toBeDisabled();
		await expect(page.locator("text=Mobile devices cannot stream")).toBeVisible();
	});
});
