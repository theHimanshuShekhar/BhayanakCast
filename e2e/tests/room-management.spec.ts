/**
 * Room Management E2E Tests
 *
 * Tests for room creation, joining, and basic functionality
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

test.describe("Room Management", () => {
	test("user can create a new room", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("E2E Test Room");
		const roomDescription = "This is an E2E test room";

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport after login
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Click create room button
		await page.locator('button:has-text("Create Room")').first().click({ force: true });

		// Fill room details
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.fill('textarea[name="description"]', roomDescription);

		// Submit form
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Wait for navigation to room page
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Verify room was created
		await expect(page.locator("h1")).toContainText(roomName);
		await expect(page.locator(`text=${roomDescription}`)).toBeVisible();
	});

	test("user can browse and join existing rooms", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Browse Test Room");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport after login
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create a room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });
		const roomUrl = page.url();

		// Go back to home
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Click on the room
		await page.click(`text=${roomName}`);

		// Verify we joined the room
		await expect(page).toHaveURL(roomUrl);
		await expect(page.locator("h1")).toContainText(roomName);
	});

	test("room displays correct status indicators", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Status Test Room");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport after login
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create a room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Check for status indicator (Preparing when no streamer)
		await expect(page.locator("text=Preparing")).toBeVisible();
	});

	test("room shows participant count", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Participant Count Test");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport after login
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create a room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Check for viewer count display
		await expect(page.locator("text=viewers")).toBeVisible();
	});

	test("user can leave room and return to home", async ({ page, signupTestUser }) => {
		const roomName = generateUniqueRoomName("Leave Test Room");

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport after login
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create and join a room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Click back button
		await page.click('button:has-text("Leave Room")');

		// Verify we're back on home page
		await expect(page).toHaveURL("/");
		await expect(page.locator("h1")).toContainText("Active Rooms");
	});

	test("room search filters rooms correctly", async ({ page, signupTestUser }) => {
		const gamingRoomName = generateUniqueRoomName("Gaming Room");
		const codingRoomName = generateUniqueRoomName("Coding Room");
		const searchTerm = gamingRoomName.split("-W")[0].toLowerCase(); // Extract "Gaming Room" part

		// Create and login test user
		const user = await signupTestUser("Test User");
		await loginUser(page, user.email);

		// Set viewport after login
		await page.setViewportSize(TEST_VIEWPORT);
		await page.waitForTimeout(500);

		// Create first room
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', gamingRoomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Create second room
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);
		await page.locator('button:has-text("Create Room")').first().click({ force: true });
		await page.fill('input[placeholder*="room name"]', codingRoomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

		// Go back to home
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Search for unique gaming room identifier
		await page.fill('input[placeholder*="Search"]', searchTerm);
		await page.waitForTimeout(500); // Wait for debounce

		// Should show Gaming Room but not Coding Room
		await expect(page.locator(`text=${gamingRoomName}`)).toBeVisible();
		await expect(page.locator(`text=${codingRoomName}`)).not.toBeVisible();
	});
});
