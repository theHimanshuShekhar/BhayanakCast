/**
 * Room Management E2E Tests
 *
 * Tests for room creation, joining, and basic functionality
 */

import { test, expect } from "@playwright/test";
import { generateUniqueRoomName } from "../utils/test-helpers";

test.describe("Room Management", () => {
	test("user can create a new room", async ({ page }) => {
		const roomName = generateUniqueRoomName("E2E Test Room");
		const roomDescription = "This is an E2E test room";

		// Navigate to home
		await page.goto("/");

		// Click create room button
		await page.click('button:has-text("Create Room")');

		// Fill room details
		await page.fill('input[name="name"]', roomName);
		await page.fill('textarea[name="description"]', roomDescription);

		// Submit form
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Wait for navigation to room page
		await page.waitForURL(/\/room\/.+/);

		// Verify room was created
		await expect(page.locator("h1")).toContainText(roomName);
		await expect(page.locator(`text=${roomDescription}`)).toBeVisible();
	});

	test("user can browse and join existing rooms", async ({ page }) => {
		const roomName = generateUniqueRoomName("Browse Test Room");

		// First create a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);
		const roomUrl = page.url();

		// Go back to home
		await page.goto("/");

		// Wait for room list to load
		await page.waitForSelector("[data-testid='room-card']");

		// Click on the room
		await page.click(`text=${roomName}`);

		// Verify we joined the room
		await expect(page).toHaveURL(roomUrl);
		await expect(page.locator("h1")).toContainText(roomName);
	});

	test("room displays correct status indicators", async ({ page }) => {
		const roomName = generateUniqueRoomName("Status Test Room");

		// Create a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Check for status indicator (Preparing when no streamer)
		await expect(page.locator("text=Preparing")).toBeVisible();

		// Check for LIVE indicator when streaming starts would show "LIVE"
		// This is tested in the streaming spec
	});

	test("room shows participant count", async ({ page }) => {
		const roomName = generateUniqueRoomName("Participant Count Test");

		// Create a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Check for viewer count display
		await expect(page.locator("text=viewers")).toBeVisible();
	});

	test("user can leave room and return to home", async ({ page }) => {
		const roomName = generateUniqueRoomName("Leave Test Room");

		// Create and join a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', roomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Click back button
		await page.click('button:has-text("Back to rooms")');

		// Verify we're back on home page
		await expect(page).toHaveURL("/");
		await expect(page.locator("text=Active Rooms")).toBeVisible();
	});

	test("room search filters rooms correctly", async ({ page }) => {
		const gamingRoomName = generateUniqueRoomName("Gaming Room");
		const codingRoomName = generateUniqueRoomName("Coding Room");
		const searchTerm = gamingRoomName.split("-W")[0].toLowerCase(); // Extract "Gaming Room" part

		// Create two rooms
		await page.goto("/");
		
		// First room
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', gamingRoomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);
		
		// Second room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', codingRoomName);
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Go back to home
		await page.goto("/");

		// Search for unique gaming room identifier
		await page.fill('input[placeholder*="Search"]', searchTerm);
		await page.waitForTimeout(500); // Wait for debounce

		// Should show Gaming Room but not Coding Room
		await expect(page.locator(`text=${gamingRoomName}`)).toBeVisible();
		await expect(page.locator(`text=${codingRoomName}`)).not.toBeVisible();
	});
});
