/**
 * Room Leaving and Rejoining E2E Tests
 *
 * Tests for:
 * - Leaving rooms
 * - Rejoining rooms
 * - Automatic cleanup when leaving
 * - Streamer transfer on leave
 */

import { test, expect } from "@playwright/test";
import { generateUniqueRoomName } from "../utils/test-helpers";

test.describe("Room Leaving", () => {
	test("user can leave a room and return to home", async ({ page }) => {
		const roomName = generateUniqueRoomName("Leave Test Room");

		// Create and join a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Click back/leave button
		await page.click('button:has-text("Leave Room")');

		// Verify returned to home
		await expect(page).toHaveURL("/");
	});

	test("participant leaving reduces viewer count", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Viewer Count Test");

		// Create room as User A
		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		await userAPage.goto("/");
		await userAPage.click('button:has-text("Create Room")');
		await userAPage.fill('input[name="name"]', roomName);
		await userAPage.click('button[type="submit"]:has-text("Create Room")');
		await userAPage.waitForURL(/\/room\/.+/);
		const roomUrl = userAPage.url();

		// Join as User B
		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();
		await userBPage.goto(roomUrl);

		// Wait for User B to appear
		await expect(userAPage.locator("text=1 viewers")).toBeVisible();

		// User B leaves
		await userBPage.click('button:has-text("Leave Room")');
		await expect(userBPage).toHaveURL("/");

		// Verify viewer count decreased on User A's screen
		await expect(userAPage.locator("text=0 viewers")).toBeVisible();

		await userAContext.close();
		await userBContext.close();
	});

	test("streamer leaving triggers automatic transfer", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Transfer Test Room");

		// Create room as User A (streamer)
		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		await userAPage.goto("/");
		await userAPage.click('button:has-text("Create Room")');
		await userAPage.fill('input[name="name"]', roomName);
		await userAPage.click('button[type="submit"]:has-text("Create Room")');
		await userAPage.waitForURL(/\/room\/.+/);
		const roomUrl = userAPage.url();

		// Join as User B (viewer)
		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();
		await userBPage.goto(roomUrl);

		// Wait for User B to join
		await expect(userAPage.locator("text=1 viewers")).toBeVisible();

		// User A (streamer) leaves
		await userAPage.click('button:has-text("Leave Room")');
		await expect(userAPage).toHaveURL("/");

		// User B should see transfer notification
		await expect(userBPage.locator("text=is now the streamer")).toBeVisible();

		// User B should now have streamer controls
		await expect(userBPage.locator('button:has-text("Start Streaming")')).toBeVisible();

		await userAContext.close();
		await userBContext.close();
	});

	test("user can rejoin a room after leaving", async ({ page }) => {
		const roomName = generateUniqueRoomName("Rejoin Test Room");

		// Create and join a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);
		const roomUrl = page.url();

		// Leave the room
		await page.click('button:has-text("Leave Room")');
		await expect(page).toHaveURL("/");

		// Rejoin the room
		await page.goto(roomUrl);

		// Verify back in the room
		await expect(page.locator("h1")).toContainText(roomName);
	});

	test("closing browser tab removes user from room", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Tab Close Test");

		// Create room as User A
		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		await userAPage.goto("/");
		await userAPage.click('button:has-text("Create Room")');
		await userAPage.fill('input[name="name"]', roomName);
		await userAPage.click('button[type="submit"]:has-text("Create Room")');
		await userAPage.waitForURL(/\/room\/.+/);
		const roomUrl = userAPage.url();

		// Join as User B
		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();
		await userBPage.goto(roomUrl);

		// Wait for User B to appear
		await expect(userAPage.locator("text=1 viewers")).toBeVisible();

		// Close User B's tab abruptly
		await userBContext.close();

		// Wait for disconnect timeout and verify User B left
		await expect(userAPage.locator("text=0 viewers")).toBeVisible({ timeout: 10000 });

		await userAContext.close();
	});

	test("multiple users can join and leave independently", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Multi User Test");

		// Create room
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

		// User C joins
		const userCContext = await browser.newContext();
		const userCPage = await userCContext.newPage();
		await userCPage.goto(roomUrl);

		// Verify 2 viewers
		await expect(userAPage.locator("text=2 viewers")).toBeVisible();

		// User B leaves
		await userBPage.click('button:has-text("Leave Room")');

		// Verify 1 viewer remains
		await expect(userAPage.locator("text=1 viewers")).toBeVisible();
		await expect(userCPage.locator("text=1 viewers")).toBeVisible();

		// User C leaves
		await userCPage.click('button:has-text("Leave Room")');

		// Verify 0 viewers
		await expect(userAPage.locator("text=0 viewers")).toBeVisible();

		await userAContext.close();
		await userBContext.close();
		await userCContext.close();
	});
});

test.describe("Room Status Transitions", () => {
	test("room status changes from preparing to active", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Status Transition Test");

		// Create room (status: preparing)
		const userAContext = await browser.newContext();
		const userAPage = await userAContext.newPage();

		await userAPage.goto("/");
		await userAPage.click('button:has-text("Create Room")');
		await userAPage.fill('input[name="name"]', roomName);
		await userAPage.click('button[type="submit"]:has-text("Create Room")');
		await userAPage.waitForURL(/\/room\/.+/);

		// Verify preparing status
		await expect(userAPage.locator("text=Preparing")).toBeVisible();

		// Another user joins
		const userBContext = await browser.newContext();
		const userBPage = await userBContext.newPage();
		await userBPage.goto(userAPage.url());

		// Status should become active
		await expect(userAPage.locator("text=Active")).toBeVisible();
		await expect(userBPage.locator("text=Active")).toBeVisible();

		await userAContext.close();
		await userBContext.close();
	});

	test("room returns to waiting when streamer leaves with no viewers", async ({ page }) => {
		const roomName = generateUniqueRoomName("Waiting Status Test");

		// Create and start streaming
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Start streaming
		await page.click('button:has-text("Start Streaming")');
		await page.click('button:has-text("Share Screen")');

		// Status should be active (streamer + 0 viewers still counts)
		await expect(page.locator("text=Active")).toBeVisible();

		// Stop streaming
		await page.click('button:has-text("Stop Sharing")');

		// Should return to preparing
		await expect(page.locator("text=Preparing")).toBeVisible();
	});
});
