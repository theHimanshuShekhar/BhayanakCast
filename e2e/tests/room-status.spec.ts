/**
 * Room Status Transitions E2E Tests
 *
 * Tests for room status lifecycle:
 * - waiting → preparing → active → preparing → waiting → ended
 */

import { test, expect } from "@playwright/test";
import { generateUniqueRoomName } from "../utils/test-helpers";

test.describe("Room Status Lifecycle", () => {
	test("room starts in preparing status when created", async ({ page }) => {
		const roomName = generateUniqueRoomName("Status Test Room");

		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Should show preparing status (streamer present, < 2 participants)
		await expect(page.locator("text=Preparing")).toBeVisible();
	});

	test("room becomes active when 2nd participant joins", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Active Status Test");

		// User A creates room
		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		await userAPage.goto("/");
		await userAPage.click('button:has-text("Create Room")');
		await userAPage.fill('input[name="name"]', roomName);
		await userAPage.click('button[type="submit"]:has-text("Create Room")');
		await userAPage.waitForURL(/\/room\/.+/);
		const roomUrl = userAPage.url();

		// Verify preparing
		await expect(userAPage.locator("text=Preparing")).toBeVisible();

		// User B joins
		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();
		await userBPage.goto(roomUrl);

		// Both should see active
		await expect(userAPage.locator("text=Active")).toBeVisible();
		await expect(userBPage.locator("text=Active")).toBeVisible();

		await userAContext.close();
		await userBContext.close();
	});

	test("room returns to waiting when all participants leave", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Waiting Status Test");

		// User A creates room
		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		await userAPage.goto("/");
		await userAPage.click('button:has-text("Create Room")');
		await userAPage.fill('input[name="name"]', roomName);
		await userAPage.click('button[type="submit"]:has-text("Create Room")');
		await userAPage.waitForURL(/\/room\/.+/);

		// User B joins (active)
		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();
		await userBPage.goto(userAPage.url());

		await expect(userAPage.locator("text=Active")).toBeVisible();

		// User A (streamer) leaves
		await userAPage.click('button:has-text("Leave Room")');
		await expect(userAPage).toHaveURL("/");

		// User B should become streamer
		await expect(userBPage.locator("text=is now the streamer")).toBeVisible();

		// User B leaves
		await userBPage.click('button:has-text("Leave Room")');
		await expect(userBPage).toHaveURL("/");

		// Room should now be empty - we'll verify by trying to rejoin
		await userAPage.goto(userBPage.url());
		// Should be able to rejoin and become streamer
		await expect(userAPage.locator("text=is now the streamer")).toBeVisible();

		await userAContext.close();
		await userBContext.close();
	});

	test("streaming starts in preparing status", async ({ page }) => {
		const roomName = generateUniqueRoomName("Streaming Status Test");

		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Preparing before streaming
		await expect(page.locator("text=Preparing")).toBeVisible();

		// Start streaming
		await page.click('button:has-text("Start Streaming")');
		await page.click('button:has-text("Share Screen")');

		// Should show LIVE indicator (active status)
		await expect(page.locator("text=LIVE")).toBeVisible();
	});

	test("stopping stream returns to preparing status", async ({ page }) => {
		const roomName = generateUniqueRoomName("Stop Stream Status Test");

		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Start streaming
		await page.click('button:has-text("Start Streaming")');
		await page.click('button:has-text("Share Screen")');
		await expect(page.locator("text=LIVE")).toBeVisible();

		// Stop streaming
		await page.click('button:has-text("Stop Sharing")');

		// Should return to preparing
		await expect(page.locator("text=Preparing")).toBeVisible();
		await expect(page.locator("text=LIVE")).not.toBeVisible();
	});

	test("status updates are broadcast to all participants", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Broadcast Status Test");

		// User A creates room
		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		await userAPage.goto("/");
		await userAPage.click('button:has-text("Create Room")');
		await userAPage.fill('input[name="name"]', roomName);
		await userAPage.click('button[type="submit"]:has-text("Create Room")');
		await userAPage.waitForURL(/\/room\/.+/);
		const roomUrl = userAPage.url();

		// User B joins
		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();
		await userBPage.goto(roomUrl);

		// Both see active
		await expect(userAPage.locator("text=Active")).toBeVisible();
		await expect(userBPage.locator("text=Active")).toBeVisible();

		// User A leaves (User B becomes streamer)
		await userAPage.click('button:has-text("Leave Room")');

		// User B should see status change notification
		await expect(userBPage.locator("text=is now the streamer")).toBeVisible();

		await userAContext.close();
		await userBContext.close();
	});
});

test.describe("Room Persistence", () => {
	test("room remains active when page is refreshed", async ({ page }) => {
		const roomName = generateUniqueRoomName("Refresh Test Room");

		// Create room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Verify in room
		await expect(page.locator("h1")).toContainText(roomName);

		// Refresh page
		await page.reload();

		// Should still be in room
		await expect(page.locator("h1")).toContainText(roomName);
	});

	test("room data persists after navigation", async ({ page }) => {
		const roomName = generateUniqueRoomName("Navigation Test Room");
		const roomDescription = "Test description";

		// Create room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.fill('textarea[name="description"]', roomDescription);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Go back to home
		await page.goto("/");

		// Room should appear in list
		await expect(page.locator(`text=${roomName}`)).toBeVisible();

		// Click on room
		await page.click(`text=${roomName}`);

		// Should be back in room with data intact
		await expect(page.locator("h1")).toContainText(roomName);
		await expect(page.locator(`text=${roomDescription}`)).toBeVisible();
	});
});
