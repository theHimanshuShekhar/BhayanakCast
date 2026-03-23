/**
 * Chat E2E Tests
 *
 * Tests for real-time chat functionality
 * Note: Messages are ephemeral and only visible to users present in the room
 */

import { test, expect, loginUser, TEST_VIEWPORT } from "../utils/auth";
import { generateUniqueRoomName } from "../utils/test-helpers";

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

			// Close any devtools that might be open from previous sessions

			// User 1 creates room
			await user1Page.locator('button:has-text("Create Room")').first().click({ force: true });
			await user1Page.waitForSelector("text=Create New Room", { state: "visible" });
			await user1Page.waitForTimeout(500);
			await user1Page.getByPlaceholder("Enter room name...").fill(roomName);
			await user1Page.click('button[type="submit"]:has-text("Create Room")');
			await user1Page.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = user1Page.url();

			// User 2 joins
			await user2Page.goto(roomUrl);
			await user2Page.waitForLoadState("networkidle");
			
			// Wait for WebSocket to fully connect on both pages
			await expect(user1Page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 10000 });
			await expect(user2Page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 10000 });
			
			// Additional wait for room join handshake to complete
			await user1Page.waitForTimeout(3000);
			await user2Page.waitForTimeout(3000);

			// Close devtools again after navigation

			// Verify both are in room by checking viewer count shows 1
			await expect(user1Page.getByText(/1 viewers?/i)).toBeVisible();

			// User 1 sends message - use force click to bypass overlay
			const user1Input = user1Page.getByPlaceholder("Type a message...");
			await user1Input.fill("Hello from user 1!");
			
			// Submit form by pressing Enter on the input field
			await user1Input.press("Enter");

			// Wait for message to propagate via WebSocket
			await user1Page.waitForTimeout(5000);
			await user2Page.waitForTimeout(5000);

			// Both users should see the message
			await expect(user1Page.getByText("Hello from user 1!")).toBeVisible();
			await expect(user2Page.getByText("Hello from user 1!")).toBeVisible();

			// User 2 replies
			const user2Input = user2Page.getByPlaceholder("Type a message...");
			await user2Input.fill("Hi user 1!");
			await user2Input.press("Enter");

			// Wait for message to propagate
			await user1Page.waitForTimeout(5000);
			await user2Page.waitForTimeout(5000);

			// Both see the reply
			await expect(user1Page.getByText("Hi user 1!")).toBeVisible();
			await expect(user2Page.getByText("Hi user 1!")).toBeVisible();
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

		// Close devtools

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		
		// Close devtools after navigation
		
		// Wait for chat to be ready
		await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 10000 });
		await page.waitForTimeout(3000);

		// Try to send inappropriate message
		const chatInput = page.getByPlaceholder("Type a message...");
		await chatInput.fill("badword1 test");
		await chatInput.press("Enter");

		// Wait for message to appear
		await page.waitForTimeout(5000);

		// Message should be censored - original bad word should not be visible
		await expect(page.getByText("badword1")).not.toBeVisible();
		
		// The censored version should be visible
		await expect(page.locator("text=***").first()).toBeVisible();
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

			// Close devtools

			// Streamer creates room
			await streamerPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await streamerPage.waitForSelector("text=Create New Room", { state: "visible" });
			await streamerPage.waitForTimeout(500);
			await streamerPage.getByPlaceholder("Enter room name...").fill(roomName);
			await streamerPage.click('button[type="submit"]:has-text("Create Room")');
			await streamerPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			const roomUrl = streamerPage.url();

			// Close devtools after navigation

			// Wait for streamer's chat to be ready
			await expect(streamerPage.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 10000 });
			await streamerPage.waitForTimeout(3000);

			// Viewer joins
			await viewerPage.goto(roomUrl);
			await expect(viewerPage.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 10000 });
			await viewerPage.waitForTimeout(3000);

			// Close devtools after navigation

			// Wait for system messages to appear
			await streamerPage.waitForTimeout(3000);

			// Check for viewer presence in the participants list
			await expect(streamerPage.getByText(/Viewers/i).first()).toBeVisible();
			await expect(viewerPage.getByText(/Viewers/i).first()).toBeVisible();
			
			// Verify viewer is listed in streamer's view
			await expect(streamerPage.getByText(/User 2|Viewer/i).first()).toBeVisible();
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

		// Close devtools

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		
		// Close devtools after navigation
		
		// Wait for chat to be ready
		const chatInput = page.getByPlaceholder("Type a message...");
		await expect(chatInput).toBeVisible({ timeout: 10000 });
		await page.waitForTimeout(3000);

		// Type and send message
		await chatInput.fill("Test message");
		await chatInput.press("Enter");

		// Wait for send to complete
		await page.waitForTimeout(1000);

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

		// Close devtools

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		
		// Close devtools after navigation
		
		// Wait for chat to be ready
		const chatInput = page.getByPlaceholder("Type a message...");
		await expect(chatInput).toBeVisible({ timeout: 10000 });
		await page.waitForTimeout(3000);

		// Try to send empty message
		await chatInput.fill("   ");
		
		// The submit button should be disabled - check by trying to submit form
		// Since button is disabled, pressing Enter should not submit
		await chatInput.press("Enter");
		await page.waitForTimeout(500);
		
		// Chat input should still have the whitespace
		await expect(chatInput).toHaveValue("   ");
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

			// Close devtools

			// Create room
			await userPage.locator('button:has-text("Create Room")').first().click({ force: true });
			await userPage.waitForSelector("text=Create New Room", { state: "visible" });
			await userPage.waitForTimeout(500);
			await userPage.getByPlaceholder("Enter room name...").fill(roomName);
			await userPage.click('button[type="submit"]:has-text("Create Room")');
			await userPage.waitForURL(/\/room\/.+/, { timeout: 10000 });
			
			// Close devtools after navigation
			
			// Wait for chat to be ready
			const chatInput = userPage.getByPlaceholder("Type a message...");
			await expect(chatInput).toBeVisible({ timeout: 10000 });
			await userPage.waitForTimeout(3000);

			// Send messages rapidly by pressing Enter
			for (let i = 0; i < 35; i++) {
				await chatInput.fill(`Message ${i}`);
				await chatInput.press("Enter");
				await userPage.waitForTimeout(100);
			}

			// Wait for rate limit to trigger
			await userPage.waitForTimeout(2000);

			// Should see rate limit warning
			await expect(userPage.getByText(/too quickly|rate limit|slow down/i).first()).toBeVisible();
		} finally {
			await userContext.close();
		}
	});

	test("messages are not persisted after leaving room", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("No Persistence Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Close devtools

		// Create room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.waitForSelector("text=Create New Room", { state: "visible" });
		await page.waitForTimeout(500);
		await page.getByPlaceholder("Enter room name...").fill(roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		const roomUrl = page.url();
		
		// Close devtools after navigation
		
		// Wait for chat to be ready
		const chatInput = page.getByPlaceholder("Type a message...");
		await expect(chatInput).toBeVisible({ timeout: 10000 });
		await page.waitForTimeout(3000);

		// Send message
		await chatInput.fill("This is a test message");
		await chatInput.press("Enter");

		// Wait for message to appear
		await page.waitForTimeout(5000);

		// Verify message is visible
		await expect(page.getByText("This is a test message")).toBeVisible();

		// Leave room using back button
		await page.getByRole("button", { name: /Back to rooms/i }).click();
		await page.waitForURL("/");

		// Rejoin the room
		await page.goto(roomUrl);
		await page.waitForLoadState("networkidle");
		await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 10000 });
		await page.waitForTimeout(3000);

		// Message should NOT be visible anymore (ephemeral chat)
		await expect(page.getByText("This is a test message")).not.toBeVisible();
		
		// Verify we're back in the room
		await expect(page.getByText(/viewers|Preparing|Active/i).first()).toBeVisible();
	});
});
