/**
 * Room Leaving and Rejoining E2E Tests
 *
 * Tests for:
 * - Leaving rooms
 * - Rejoining rooms
 * - Automatic cleanup when leaving
 * - Streamer transfer on leave
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
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Click back/leave button
		await page.click('button:has-text("Leave Room")');

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
			await userAPage.fill('input[placeholder*="room name"]', roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = userAPage.url();

			// User B joins
			await userBPage.goto(roomUrl);
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Wait for User B to appear
			await expect(userAPage.locator("text=1 viewers")).toBeVisible();

			// User B leaves
			await userBPage.click('button:has-text("Leave Room")');
			await expect(userBPage).toHaveURL("/");

			// Verify viewer count decreased on User A's screen
			await expect(userAPage.locator("text=0 viewers")).toBeVisible();
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
			await userAPage.fill('input[placeholder*="room name"]', roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = userAPage.url();

			// User B joins
			await userBPage.goto(roomUrl);
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Wait for User B to join
			await expect(userAPage.locator("text=1 viewers")).toBeVisible();

			// User A leaves
			await userAPage.click('button:has-text("Leave Room")');
			await expect(userAPage).toHaveURL("/");

			// User B should see transfer notification
			await expect(userBPage.locator("text=is now the streamer")).toBeVisible();

			// User B should now have streamer controls
			await expect(userBPage.locator('button:has-text("Start Streaming")')).toBeVisible();
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
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		const roomUrl = page.url();

		// Leave the room
		await page.click('button:has-text("Leave Room")');
		await expect(page).toHaveURL("/");

		// Rejoin the room
		await page.goto(roomUrl);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Verify back in the room
		await expect(page.locator("h1")).toContainText(roomName);
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
			await userAPage.fill('input[placeholder*="room name"]', roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = userAPage.url();

			// User B joins
			await userBPage.goto(roomUrl);
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Wait for User B to appear
			await expect(userAPage.locator("text=1 viewers")).toBeVisible();

			// Close User B's tab abruptly
			await userBContext.close();

			// Wait for disconnect timeout and verify User B left
			await expect(userAPage.locator("text=0 viewers")).toBeVisible({ timeout: 10000 });
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
			await userAPage.fill('input[placeholder*="room name"]', roomName);
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
			await userAPage.fill('input[placeholder*="room name"]', roomName);
			await userAPage.click('button[type="submit"]:has-text("Create Room")');
			await userAPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// Verify preparing status
			await expect(userAPage.locator("text=Preparing")).toBeVisible();

			// User B joins
			await userBPage.goto(userAPage.url());
			await userBPage.waitForLoadState("networkidle");
			await userBPage.waitForTimeout(1000);

			// Status should become active
			await expect(userAPage.locator("text=Active")).toBeVisible();
			await expect(userBPage.locator("text=Active")).toBeVisible();
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
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

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
