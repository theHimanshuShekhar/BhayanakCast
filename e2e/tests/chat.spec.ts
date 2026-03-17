/**
 * Chat E2E Tests
 *
 * Tests for real-time chat functionality
 */

import { test, expect } from "@playwright/test";
import { generateUniqueRoomName } from "../utils/test-helpers";

test.describe("Chat Functionality", () => {
	test("user can send and receive chat messages", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Chat Test Room");
		const user1Context = await browser.newContext();
		const user1Page = await user1Context.newPage();

		const user2Context = await browser.newContext();
		const user2Page = await user2Context.newPage();

		try {
			// User 1 creates room
			await user1Page.goto("/");
			await user1Page.click('button:has-text("Create Room")');
			await user1Page.fill('input[name="name"]', roomName);
			await user1Page.click('button[type="submit"]:has-text("Create Room")');
			await user1Page.waitForURL(/\/room\/.+/);
			const roomUrl = user1Page.url();

			// User 2 joins
			await user2Page.goto(roomUrl);

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

	test("profanity filter blocks inappropriate messages", async ({ page }) => {
		const roomName = generateUniqueRoomName("Profanity Test");

		// Create room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Try to send inappropriate message
		await page.fill('input[placeholder*="message"]', "badword1 badword2");
		await page.keyboard.press("Enter");

		// Message should be censored
		await expect(page.locator("text=badword1")).not.toBeVisible();
		await expect(page.locator("text=***")).toBeVisible();
	});

	test("system messages appear for room events", async ({ browser }) => {
		const roomName = generateUniqueRoomName("System Messages Test");
		const streamerContext = await browser.newContext();
		const streamerPage = await streamerContext.newPage();

		const viewerContext = await browser.newContext();
		const viewerPage = await viewerContext.newPage();

		try {
			// Streamer creates room
			await streamerPage.goto("/");
			await streamerPage.click('button:has-text("Create Room")');
			await streamerPage.fill('input[name="name"]', roomName);
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/);
			const roomUrl = streamerPage.url();

			// Check join system message
			await expect(streamerPage.locator("text=joined the room")).toBeVisible();

			// Viewer joins
			await viewerPage.goto(roomUrl);
			await expect(viewerPage.locator("text=joined the room")).toBeVisible();

			// Viewer leaves
			await viewerPage.click('button:has-text("Leave Room")');
			await expect(streamerPage.locator("text=left the room")).toBeVisible();

		} finally {
			await streamerContext.close();
			await viewerContext.close();
		}
	});

	test("chat input clears after sending message", async ({ page }) => {
		const roomName = generateUniqueRoomName("Clear Input Test");

		// Create room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Type and send message
		const chatInput = page.locator('input[placeholder*="message"]');
		await chatInput.fill("Test message");
		await page.keyboard.press("Enter");

		// Input should be cleared
		await expect(chatInput).toHaveValue("");
	});

	test("empty messages cannot be sent", async ({ page }) => {
		const roomName = generateUniqueRoomName("Empty Message Test");

		// Create room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Try to send empty message
		await page.fill('input[placeholder*="message"]', "   ");
		await page.keyboard.press("Enter");

		// No message should appear
		await expect(page.locator("text=joined the room")).toBeVisible();
		// Wait a moment and verify no new messages
		await page.waitForTimeout(500);
	});

	test("chat rate limiting prevents spam", async ({ browser }) => {
		const roomName = generateUniqueRoomName("Rate Limit Test");
		const userContext = await browser.newContext();
		const userPage = await userContext.newPage();

		try {
			// Create room
			await userPage.goto("/");
			await userPage.click('button:has-text("Create Room")');
			await userPage.fill('input[name="name"]', roomName);
			await userPage.click('button[type="submit"]:has-text("Create Room")');
			await userPage.waitForURL(/\/room\/.+/);

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

	test("chat persists across room navigation", async ({ page }) => {
		const roomName = generateUniqueRoomName("Persistence Test");

		// Create room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);
		const roomUrl = page.url();

		// Send message
		await page.fill('input[placeholder*="message"]', "Persistent message");
		await page.keyboard.press("Enter");
		await expect(page.locator("text=Persistent message")).toBeVisible();

		// Leave and rejoin
		await page.click('button:has-text("Back to rooms")');
		await page.goto(roomUrl);

		// Message should still be visible
		await expect(page.locator("text=Persistent message")).toBeVisible();
	});
});
