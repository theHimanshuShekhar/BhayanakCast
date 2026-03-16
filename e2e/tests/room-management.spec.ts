/**
 * Room Management E2E Tests
 *
 * Tests for room creation, joining, and basic functionality
 */

import { test, expect } from "@playwright/test";

test.describe("Room Management", () => {
	test("user can create a new room", async ({ page }) => {
		// Navigate to home
		await page.goto("/");

		// Click create room button
		await page.click('button:has-text("Create Room")');

		// Fill room details
		await page.fill('input[name="name"]', "E2E Test Room");
		await page.fill('textarea[name="description"]', "This is an E2E test room");

		// Submit form
		await page.click('button[type="submit"]:has-text("Create Room")');

		// Wait for navigation to room page
		await page.waitForURL(/\/room\/.+/);

		// Verify room was created
		await expect(page.locator("h1")).toContainText("E2E Test Room");
		await expect(page.locator("text=This is an E2E test room")).toBeVisible();
	});

	test("user can browse and join existing rooms", async ({ page }) => {
		// First create a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Browse Test Room");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);
		const roomUrl = page.url();

		// Go back to home
		await page.goto("/");

		// Wait for room list to load
		await page.waitForSelector("[data-testid='room-card']");

		// Click on the room
		await page.click('text=Browse Test Room');

		// Verify we joined the room
		await expect(page).toHaveURL(roomUrl);
		await expect(page.locator("h1")).toContainText("Browse Test Room");
	});

	test("room displays correct status indicators", async ({ page }) => {
		// Create a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Status Test Room");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Check for status indicator (Preparing when no streamer)
		await expect(page.locator("text=Preparing")).toBeVisible();

		// Check for LIVE indicator when streaming starts would show "LIVE"
		// This is tested in the streaming spec
	});

	test("room shows participant count", async ({ page }) => {
		// Create a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Participant Count Test");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Check for viewer count display
		await expect(page.locator("text=viewers")).toBeVisible();
	});

	test("user can leave room and return to home", async ({ page }) => {
		// Create and join a room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Leave Test Room");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Click back button
		await page.click('button:has-text("Back to rooms")');

		// Verify we're back on home page
		await expect(page).toHaveURL("/");
		await expect(page.locator("text=Active Rooms")).toBeVisible();
	});

	test("room search filters rooms correctly", async ({ page }) => {
		// Create two rooms
		await page.goto("/");
		
		// First room
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Gaming Room");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);
		
		// Second room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Coding Room");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Go back to home
		await page.goto("/");

		// Search for "gaming"
		await page.fill('input[placeholder*="Search"]', "gaming");
		await page.waitForTimeout(500); // Wait for debounce

		// Should show Gaming Room but not Coding Room
		await expect(page.locator('text=Gaming Room')).toBeVisible();
		await expect(page.locator('text=Coding Room')).not.toBeVisible();
	});
});
