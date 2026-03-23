/**
 * Room Status Transitions E2E Tests
 *
 * Tests for room status lifecycle:
 * - waiting → preparing → active → preparing → waiting → ended
 */

import { test, expect, loginUser, TEST_VIEWPORT } from "../utils/auth";
import { generateUniqueRoomName } from "../utils/test-helpers";

test.describe("Room Status Lifecycle", () => {
	test("room starts in preparing status when created", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Status Test Room");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await page.waitForTimeout(1000);

		// Should show preparing status (streamer present, < 2 participants)
		await expect(page.locator("span:has-text('Preparing')").first()).toBeVisible();
	});

	test("room becomes active when 2nd participant joins", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Active Status Test");

		// Create two test users
		const userA = await signupTestUser("User A");
		const userB = await signupTestUser("User B");

		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();

		try {
			// Login both users
			await loginUser(userAPage, userA.email);
			await loginUser(userBPage, userB.email);

			// Set viewports
			await userAPage.setViewportSize(TEST_VIEWPORT);
			await userBPage.setViewportSize(TEST_VIEWPORT);
			await userAPage.waitForTimeout(500);
			await userBPage.waitForTimeout(500);

			// User A creates room
			await userAPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await userAPage.waitForSelector("text=Create New Room", { state: "visible" });
			await userAPage.waitForTimeout(500);
			await userAPage.getByPlaceholder("Enter room name...").fill(roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// Wait for room to load
			await userAPage.waitForTimeout(2000);

			// Verify preparing
			await expect(userAPage.locator("span:has-text('Preparing')").first()).toBeVisible();

			// User B joins
			await userBPage.goto(userAPage.url());
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Wait for status sync
			await userAPage.waitForTimeout(2000);

			// Both should see active
			await expect(userAPage.locator("span:has-text('Active')").first()).toBeVisible();
			await expect(userBPage.locator("span:has-text('Active')").first()).toBeVisible();
		} finally {
			await userAContext.close();
			await userBContext.close();
		}
	});

	test("room returns to waiting when all participants leave", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Waiting Status Test");

		// Create two test users
		const userA = await signupTestUser("User A");
		const userB = await signupTestUser("User B");

		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();

		try {
			// Login both users
			await loginUser(userAPage, userA.email);
			await loginUser(userBPage, userB.email);

			// Set viewports
			await userAPage.setViewportSize(TEST_VIEWPORT);
			await userBPage.setViewportSize(TEST_VIEWPORT);
			await userAPage.waitForTimeout(500);
			await userBPage.waitForTimeout(500);

			// User A creates room
			await userAPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await userAPage.waitForSelector("text=Create New Room", { state: "visible" });
			await userAPage.waitForTimeout(500);
			await userAPage.getByPlaceholder("Enter room name...").fill(roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// User B joins (active)
			await userBPage.goto(userAPage.url());
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Wait for sync
			await userAPage.waitForTimeout(2000);
			await expect(userAPage.locator("span:has-text('Active')").first()).toBeVisible();

			// User A (streamer) leaves using back button
			await userAPage.getByRole("button", { name: /Back to rooms/i }).click();
			await expect(userAPage).toHaveURL("/");

			// Wait for transfer
			await userBPage.waitForTimeout(2000);

			// User B should become streamer
			await expect(userBPage.locator("text=/now the streamer/i").first()).toBeVisible();

			// User B leaves
			await userBPage.getByRole("button", { name: /Back to rooms/i }).click();
			await expect(userBPage).toHaveURL("/");
		} finally {
			await userAContext.close();
			await userBContext.close();
		}
	});

	test("streaming starts in preparing status", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Streaming Status Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await page.waitForTimeout(1000);

		// Preparing before streaming
		await expect(page.locator("span:has-text('Preparing')").first()).toBeVisible();

		// Start streaming
		await page.click('button:has-text("Start Streaming")');
		await page.click('button:has-text("Share Screen")');
		await page.waitForTimeout(3000);

		// Should show LIVE indicator (active status)
		await expect(page.locator("text=LIVE").first()).toBeVisible();
	});

	test("stopping stream returns to preparing status", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Stop Stream Status Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await page.waitForTimeout(1000);

		// Start streaming
		await page.click('button:has-text("Start Streaming")');
		await page.click('button:has-text("Share Screen")');
		await page.waitForTimeout(3000);
		await expect(page.locator("text=LIVE").first()).toBeVisible();

		// Stop streaming
		await page.click('button:has-text("Stop Sharing")');
		await page.waitForTimeout(1000);

		// Should return to preparing
		await expect(page.locator("span:has-text('Preparing')").first()).toBeVisible();
		await expect(page.locator("text=LIVE")).not.toBeVisible();
	});

	test("status updates are broadcast to all participants", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Broadcast Status Test");

		// Create two test users
		const userA = await signupTestUser("User A");
		const userB = await signupTestUser("User B");

		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();

		try {
			// Login both users
			await loginUser(userAPage, userA.email);
			await loginUser(userBPage, userB.email);

			// Set viewports
			await userAPage.setViewportSize(TEST_VIEWPORT);
			await userBPage.setViewportSize(TEST_VIEWPORT);
			await userAPage.waitForTimeout(500);
			await userBPage.waitForTimeout(500);

			// User A creates room
			await userAPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await userAPage.waitForSelector("text=Create New Room", { state: "visible" });
			await userAPage.waitForTimeout(500);
			await userAPage.getByPlaceholder("Enter room name...").fill(roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// User B joins
			await userBPage.goto(userAPage.url());
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Wait for sync
			await userAPage.waitForTimeout(2000);

			// Both see active
			await expect(userAPage.locator("span:has-text('Active')").first()).toBeVisible();
			await expect(userBPage.locator("span:has-text('Active')").first()).toBeVisible();

			// User A (streamer) leaves
			await userAPage.getByRole("button", { name: /Back to rooms/i }).click();

			// Wait for transfer
			await userBPage.waitForTimeout(2000);

			// User B should see status change notification
			await expect(userBPage.locator("text=/now the streamer/i").first()).toBeVisible();
		} finally {
			await userAContext.close();
			await userBContext.close();
		}
	});
});

test.describe("Room Persistence", () => {
	test("room remains active when page is refreshed", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Refresh Test Room");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Verify in room
		const roomId = roomName.split("-")[2];
		await expect(page.locator("h1")).toContainText(roomId);

		// Refresh page
		await page.reload();
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Should still be in room
		await expect(page.locator("h1")).toContainText(roomId);
	});

	test("room data persists after navigation", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Navigation Test Room");
		const roomDescription = "Test description";

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.getByRole("textbox", { name: "Description (Optional)" }).fill(roomDescription);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Go back to home using back button
		await page.getByRole("button", { name: /Back to rooms/i }).click();
		await expect(page).toHaveURL("/");

		// Room should appear in list
		const roomId = roomName.split("-")[2];
		await expect(page.locator(`a:has-text("${roomId}")`)).toBeVisible();

		// Click on room
		await page.locator(`a:has-text("${roomId}")`).click();

		// Should be back in room with data intact
		await expect(page.locator("h1")).toContainText(roomId);
		await expect(page.locator(`text=${roomDescription}`)).toBeVisible();
	});
});
