/**
 * Room Management E2E Tests
 *
 * Tests for room creation, joining, and basic functionality
 */

import { test, expect, loginUser, TEST_VIEWPORT } from "../utils/auth";
import { generateUniqueRoomName } from "../utils/test-helpers";

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

    // Wait for modal to be fully visible
    await page.waitForSelector("text=Create New Room", { state: "visible" });
    await page.waitForTimeout(500);

    // Fill room details
    await page.getByPlaceholder("Enter room name...").fill(roomName);
    await page.getByRole("textbox", { name: "Description (Optional)" }).fill(roomDescription);

    // Submit form
    await page.click('button[type="submit"]:has-text("Create Room")');

    // Wait for navigation to room page
    await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

    // Verify room was created (use room ID since name might be censored)
    const roomId = roomName.split("-")[2];
    await expect(page.locator("h1")).toContainText(roomId);
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

    // Go back to home and reload
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Search for the room
    await page.fill('input[placeholder*="Search"]', roomName);
    await page.waitForTimeout(1000);

    // Click on the room (use room ID for matching)
    const roomId = roomName.split("-")[2];
    await page.locator(`a:has-text("${roomId}")`).click();

    // Verify we joined the room
    await expect(page).toHaveURL(roomUrl);
    await expect(page.locator("h1")).toContainText(roomId);
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

    // Check for viewer count display (be specific to avoid multiple matches)
    await expect(page.locator("span:has-text('viewers')").first()).toBeVisible();
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

    // Wait for page to fully load
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Click back button (use the "Back to rooms" button which is more reliable)
    await page.getByRole("button", { name: /Back to rooms/i }).click();

    // Verify we're back on home page
    await expect(page).toHaveURL("/");
    await expect(page.locator("h1")).toContainText("Active Rooms");
  });

  test("room search filters rooms correctly", async ({ page, signupTestUser }) => {
    // Create unique room names with different prefixes to avoid timestamp collision
    const timestamp = Date.now();
    const gamingRoomName = `Gaming-Search-${timestamp}`;
    const codingRoomName = `Coding-Search-${timestamp}`;

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

    // Wait a bit to ensure different timestamps
    await page.waitForTimeout(100);

    // Create second room
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    await page.locator('button:has-text("Create Room")').first().click({ force: true });
    await page.fill('input[placeholder*="room name"]', codingRoomName);
    await page.click('button[type="submit"]:has-text("Create Room")');
    await page.waitForURL(/\/room\/.+/, { timeout: 10000 });

    // Go back to home and reload
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Search for "Gaming" rooms
    await page.fill('input[placeholder*="Search"]', "Gaming-Search");
    await page.waitForTimeout(1000);

    // Should show Gaming Room but not Coding Room
    await expect(page.getByRole("link", { name: /Gaming-Search/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Coding-Search/ })).not.toBeVisible();
  });
});
