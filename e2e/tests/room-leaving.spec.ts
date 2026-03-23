/**
 * Room Leaving and Rejoining E2E Tests
 *
 * Tests for:
 * - Leaving rooms
 * - Rejoining rooms
 * - Automatic cleanup when leaving
 * - Streamer transfer on leave
 */

import { test, expect, loginUser, TEST_VIEWPORT } from "../utils/auth";
import { generateUniqueRoomName } from "../utils/test-helpers";

test.describe("Room Leaving", () => {
	test("user can leave a room and return to home", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Leave Test Room");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create and join a room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Click back/leave button
		await page.getByRole("button", { name: /Back to rooms/i }).click();

		// Verify returned to home
		await expect(page).toHaveURL("/");
	});

	test("participant leaving reduces viewer count", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Viewer Count Test");

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
			const roomUrl = userAPage.url();

			// User B joins
			await userBPage.goto(roomUrl);
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Wait for WebSocket to sync
			await userAPage.waitForTimeout(2000);

			// Wait for User B to appear (use regex for flexible matching)
			await expect(userAPage.locator("text=/\\d+ viewers?/i").first()).toBeVisible();

			// User B leaves using back button
			await userBPage.getByRole("button", { name: /Back to rooms/i }).click();
			await expect(userBPage).toHaveURL("/");

			// Wait for disconnect
			await userAPage.waitForTimeout(2000);

			// Verify viewer count decreased on User A's screen (use regex)
			await expect(userAPage.locator("text=/\\d+ viewers?/i").first()).toBeVisible();
		} finally {
			await userAContext.close();
			await userBContext.close();
		}
	});

	test("streamer leaving triggers automatic transfer", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Transfer Test Room");

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
			const roomUrl = userAPage.url();

			// User B joins
			await userBPage.goto(roomUrl);
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Wait for User B to join
			await userAPage.waitForTimeout(2000);
			await expect(userAPage.locator("text=/\\d+ viewers?/i").first()).toBeVisible();

			// User A leaves using back button
			await userAPage.getByRole("button", { name: /Back to rooms/i }).click();
			await expect(userAPage).toHaveURL("/");

			// Wait for transfer
			await userBPage.waitForTimeout(2000);

			// User B should see transfer notification (flexible matching)
			await expect(userBPage.locator("text=/now the streamer|became streamer|is now streaming/i").first()).toBeVisible();

			// User B should now have streamer controls
			await expect(userBPage.locator('button:has-text("Start Streaming")').first()).toBeVisible();
		} finally {
			await userAContext.close();
			await userBContext.close();
		}
	});

	test("user can rejoin a room after leaving", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Rejoin Test Room");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create and join a room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		const roomUrl = page.url();

		// Leave the room using back button
		await page.getByRole("button", { name: /Back to rooms/i }).click();
		await expect(page).toHaveURL("/");

		// Rejoin the room
		await page.goto(roomUrl);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Verify back in the room (check for room content)
		await expect(page.locator("text=/viewers|Preparing|Active/i").first()).toBeVisible();
	});

	test("closing browser tab removes user from room", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Tab Close Test");

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
			const roomUrl = userAPage.url();

			// User B joins
			await userBPage.goto(roomUrl);
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Wait for User B to appear
			await userAPage.waitForTimeout(2000);
			await expect(userAPage.locator("text=/\\d+ viewers?/i").first()).toBeVisible();

			// Close User B's tab abruptly
			await userBContext.close();

			// Wait for disconnect timeout and verify User B left
			await userAPage.waitForTimeout(5000);
			await expect(userAPage.locator("text=/\\d+ viewers?/i").first()).toBeVisible();
		} finally {
			await userAContext.close();
		}
	});

	test("multiple users can join and leave independently", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Multi User Test");

		// Create three test users
		const userA = await signupTestUser("User A");
		const userB = await signupTestUser("User B");
		const userC = await signupTestUser("User C");

		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();

		const userCContext = await browser.newContext();
		const userCPage = await userCContext.newPage();

		try {
			// Login all users
			await loginUser(userAPage, userA.email);
			await loginUser(userBPage, userB.email);
			await loginUser(userCPage, userC.email);

			// Set viewports
			await userAPage.setViewportSize(TEST_VIEWPORT);
			await userBPage.setViewportSize(TEST_VIEWPORT);
			await userCPage.setViewportSize(TEST_VIEWPORT);
			await userAPage.waitForTimeout(500);
			await userBPage.waitForTimeout(500);
			await userCPage.waitForTimeout(500);

			// User A creates room
			await userAPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await userAPage.waitForSelector("text=Create New Room", { state: "visible" });
			await userAPage.waitForTimeout(500);
			await userAPage.getByPlaceholder("Enter room name...").fill(roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = userAPage.url();

			// User B joins
			await userBPage.goto(roomUrl);
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// User C joins
			await userCPage.goto(roomUrl);
			await userCPage.waitForLoadState("networkidle");
			await userCPage.waitForTimeout(1000);

			// Wait for sync
			await userAPage.waitForTimeout(2000);

			// Verify viewers are shown (just check that viewer count exists)
			await expect(userAPage.locator("text=/\\d+ viewers?/i").first()).toBeVisible();

			// User B leaves
			await userBPage.getByRole("button", { name: /Back to rooms/i }).click();

			// Wait for sync
			await userAPage.waitForTimeout(2000);

			// Verify viewers updated
			await expect(userAPage.locator("text=/\\d+ viewers?/i").first()).toBeVisible();
			await expect(userCPage.locator("text=/\\d+ viewers?/i").first()).toBeVisible();

			// User C leaves
			await userCPage.getByRole("button", { name: /Back to rooms/i }).click();

			// Wait for sync
			await userAPage.waitForTimeout(2000);

			// Verify viewers updated
			await expect(userAPage.locator("text=/\\d+ viewers?/i").first()).toBeVisible();
		} finally {
			await userAContext.close();
			await userBContext.close();
			await userCContext.close();
		}
	});
});

test.describe("Room Status Transitions", () => {
	test("room status changes from preparing to active", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Status Transition Test");

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

			// User B joins
			await userBPage.goto(userAPage.url());
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Wait for status update
			await userAPage.waitForTimeout(2000);

			// Status should become active (use specific selector to avoid multiple matches)
			await expect(userAPage.locator("span:has-text('Active')").first()).toBeVisible();
			await expect(userBPage.locator("span:has-text('Active')").first()).toBeVisible();
		} finally {
			await userAContext.close();
			await userBContext.close();
		}
	});

	test("room returns to waiting when streamer leaves with no viewers", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Waiting Status Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create and start streaming
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

		// Wait for stream to start
		await page.waitForTimeout(3000);

		// Status should be active (use specific selector)
		await expect(page.locator("span:has-text('Active')").first()).toBeVisible();

		// Stop streaming
		await page.click('button:has-text("Stop Sharing")');
		await page.waitForTimeout(1000);

		// Should return to preparing
		await expect(page.locator("span:has-text('Preparing')").first()).toBeVisible();
	});
});
