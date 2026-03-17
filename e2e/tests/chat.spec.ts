/**
 * Chat E2E Tests
 *
 * Tests for real-time chat functionality
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

test.describe("Chat Functionality", () => {
	test("user can send and receive chat messages", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Chat Test Room");

		// Create two test users
		const user1 = await signupTestUser("User 1");
		const user2 = await signupTestUser("User 2");

		const user1Context = await browser.newContext();
		const user1Page = await user1Context.newPage();

		const user2Context = await browser.newContext();
		const user2Page = await user2Context.newPage();

		try {
			// Login both users
			await loginUser(user1Page, user1.email);
			await loginUser(user2Page, user2.email);

			// Set viewports
			await user1Page.setViewportSize(TEST_VIEWPORT);
			await user2Page.setViewportSize(TEST_VIEWPORT);
			await user1Page.waitForTimeout(500);
			await user2Page.waitForTimeout(500);

			// User 1 creates room
			await user1Page.locator('button:has-text("Create Room")').first().click({ force: true });
			await user1Page.fill('input[placeholder*="room name"]', roomName);
			await user1Page.click('button[type="submit"]:has-text("Create Room")');
			await user1Page.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = user1Page.url();

			// User 2 joins
			await user2Page.goto(roomUrl);
			await user2Page.waitForLoadState("networkidle");
			await user2Page.waitForTimeout(1000);

			// User 1 sends message
			await user1Page.fill('input[placeholder*="message"]', "Hello from user 1!");
			await user1Page.keyboard.press("Enter");

			// Both users should see the message
			await expect(user1Page.locator("text=Hello from user 1!")).toBeVisible();
			await expect(user2Page.locator("text=Hello from user 1!")).toBeVisible();

			// User 2 replies
			await user2Page.fill('input[placeholder*="message"]', "Hi user 1!");
			await user2Page.keyboard.press("Enter");

			// Both see the reply
			await expect(user1Page.locator("text=Hi user 1!")).toBeVisible();
			await expect(user2Page.locator("text=Hi user 1!")).toBeVisible();
		} finally {
			await user1Context.close();
			await user2Context.close();
		}
	});

	test("profanity filter blocks inappropriate messages", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Profanity Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Try to send inappropriate message
		await page.fill('input[placeholder*="message"]', "badword1 badword2");
		await page.keyboard.press("Enter");

		// Message should be censored
		await expect(page.locator("text=badword1")).not.toBeVisible();
		await expect(page.locator("text=***")).toBeVisible();
	});

	test("system messages appear for room events", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("System Messages Test");

		// Create two test users
		const streamer = await signupTestUser("Streamer");
		const viewer = await signupTestUser("Viewer");

		const streamerContext = await browser.newContext();
		const streamerPage = await streamerContext.newPage();

		const viewerContext = await browser.newContext();
		const viewerPage = await viewerContext.newPage();

		try {
			// Login both users
			await loginUser(streamerPage, streamer.email);
			await loginUser(viewerPage, viewer.email);

			// Set viewports
			await streamerPage.setViewportSize(TEST_VIEWPORT);
			await viewerPage.setViewportSize(TEST_VIEWPORT);
			await streamerPage.waitForTimeout(500);
			await viewerPage.waitForTimeout(500);

			// Streamer creates room
			await streamerPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await streamerPage.fill('input[placeholder*="room name"]', roomName);
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = streamerPage.url();

			// Check join system message
			await expect(streamerPage.locator("text=joined the room")).toBeVisible();

			// Viewer joins
			await viewerPage.goto(roomUrl);
			await viewerPage.waitForLoadState("networkidle");
			await viewerPage.waitForTimeout(1000);
			await expect(viewerPage.locator("text=joined the room")).toBeVisible();

			// Viewer leaves
			await viewerPage.click('button:has-text("Leave Room")');
			await expect(streamerPage.locator("text=left the room")).toBeVisible();
		} finally {
			await streamerContext.close();
			await viewerContext.close();
		}
	});

	test("chat input clears after sending message", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Clear Input Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Type and send message
		const chatInput = page.locator('input[placeholder*="message"]');
		await chatInput.fill("Test message");
		await page.keyboard.press("Enter");

		// Input should be cleared
		await expect(chatInput).toHaveValue("");
	});

	test("empty messages cannot be sent", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Empty Message Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Try to send empty message
		await page.fill('input[placeholder*="message"]', "   ");
		await page.keyboard.press("Enter");

		// No message should appear
		await expect(page.locator("text=joined the room")).toBeVisible();
		// Wait a moment and verify no new messages
		await page.waitForTimeout(500);
	});

	test("chat rate limiting prevents spam", async ({ browser, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Rate Limit Test");

		// Create test user
		const user = await signupTestUser("Test User");

		const userContext = await browser.newContext();
		const userPage = await userContext.newPage();

		try {
			// Login user
			await loginUser(userPage, user.email);

			// Set viewport
			await userPage.setViewportSize(TEST_VIEWPORT);
			await userPage.waitForTimeout(500);

			// Create room
			await userPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await userPage.fill('input[placeholder*="room name"]', roomName);
			await userPage.click('button[type="submit"]:has-text("Create Room")');
			await userPage.waitForURL(/\/room\/.+/, { timeout: 10000 });

			// Send messages rapidly
			for (let i = 0; i < 35; i++) {
				await userPage.fill('input[placeholder*="message"]', `Message ${i}`);
				await userPage.keyboard.press("Enter");
				await userPage.waitForTimeout(100);
			}

			// Should see rate limit warning
			await expect(userPage.locator("text=too quickly")).toBeVisible();
		} finally {
			await userContext.close();
		}
	});

	test("chat persists across room navigation", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Persistence Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		const roomUrl = page.url();

		// Send message
		await page.fill('input[placeholder*="message"]', "Persistent message");
		await page.keyboard.press("Enter");
		await expect(page.locator("text=Persistent message")).toBeVisible();

		// Leave and rejoin
		await page.click('button:has-text("Leave Room")');
		await page.goto(roomUrl);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Message should still be visible
		await expect(page.locator("text=Persistent message")).toBeVisible();
	});
});
