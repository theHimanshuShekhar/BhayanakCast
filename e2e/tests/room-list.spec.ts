/**
 * Room List and Home Page E2E Tests
 */

import { test, expect } from "@playwright/test";
import { generateUniqueRoomName } from "../utils/test-helpers";

// Use viewport where Create Room button is visible (< 1280px due to xl:hidden)
const TEST_VIEWPORT = { width: 1200, height: 800 };

// Helper function to log in a test user
async function loginTestUser(page: any, email: string) {
  await page.goto("/auth/sign-in");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000); // Wait for React hydration
  
  // Fill in login form
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "testpassword123");
  await page.click('button[type="submit"]');
  
  // Wait for navigation to home
  await page.waitForURL("http://localhost:3000/", { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000); // Wait for React hydration
}

// Helper function to create a test user via API
async function createTestUser(request: any): Promise<{ email: string; userId: string }> {
  const response = await request.post("http://localhost:3000/api/test/auth/signup", {
    data: { name: "Test User" },
    headers: { "Content-Type": "application/json" },
  });
  
  if (!response.ok()) {
    throw new Error("Failed to create test user");
  }
  
  const data = await response.json();
  return { email: data.email, userId: data.userId };
}

test.describe("Room List on Home Page", () => {
  test("displays list of active rooms", async ({ page, request }) => {
    const roomName = generateUniqueRoomName("List Test Room");
    
    // Create and log in test user (at default viewport)
    const user = await createTestUser(request);
    await loginTestUser(page, user.email);
    
    // NOW set 2K viewport after login
    await page.setViewportSize(TEST_VIEWPORT);
    await page.waitForTimeout(1000);

    // Should see room list header
    await expect(page.locator("h1")).toContainText("Active Rooms");

    // Create a room (use force since button might be hidden at 2K)
    await page.locator('button:has-text("Create Room")').first().click({ force: true });
    await page.fill('input[placeholder*="room name"]', roomName);
    await page.click('button[type="submit"]:has-text("Create Room")');
    await page.waitForURL(/\/room\/.+/);

    // Go back to home
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Should see the room in the list
    await expect(page.locator(`text=${roomName}`)).toBeVisible();
  });

  test("clicking room card navigates to room", async ({ page, request }) => {
    const roomName = generateUniqueRoomName("Clickable Room");
    
    // Create and log in test user
    const user = await createTestUser(request);
    await loginTestUser(page, user.email);
    
    // Set 2K viewport
    await page.setViewportSize(TEST_VIEWPORT);
    await page.waitForTimeout(1000);

    // Create room first
    await page.locator('button:has-text("Create Room")').first().click({ force: true });
    await page.fill('input[placeholder*="room name"]', roomName);
    await page.click('button[type="submit"]:has-text("Create Room")');
    await page.waitForURL(/\/room\/.+/);

    const roomUrl = page.url();

    // Go back home
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Click the room card
    await page.click(`text=${roomName}`);

    // Should navigate to room
    await expect(page).toHaveURL(roomUrl);
    await expect(page.locator("h1")).toContainText(roomName);
  });

  test.skip("shows empty state when no rooms", async ({ page }) => {
    // Skipped: Requires clean database state, may have existing rooms from other tests
    await page.goto("/");
    await expect(page.locator("text=No rooms found")).toBeVisible();
  });
});

test.describe("Home Page Navigation", () => {
  test("create room button opens modal", async ({ page, request }) => {
    // Create and log in test user
    const user = await createTestUser(request);
    await loginTestUser(page, user.email);
    
    // Set 2K viewport
    await page.setViewportSize(TEST_VIEWPORT);
    await page.waitForTimeout(1000);

    // Click create room (use force click)
    await page.locator('button:has-text("Create Room")').first().click({ force: true });

    // Modal should open
    await expect(page.locator("text=Create New Room")).toBeVisible();
    await expect(page.locator('input[placeholder*="Enter room name"]')).toBeVisible();
  });

  test("logo navigates to home", async ({ page, request }) => {
    const roomName = generateUniqueRoomName("Logo Test");
    
    // Create and log in test user
    const user = await createTestUser(request);
    await loginTestUser(page, user.email);
    
    // Set 2K viewport
    await page.setViewportSize(TEST_VIEWPORT);
    await page.waitForTimeout(1000);

    // Create and go to room
    await page.locator('button:has-text("Create Room")').first().click({ force: true });
    await page.fill('input[placeholder*="room name"]', roomName);
    await page.click('button[type="submit"]:has-text("Create Room")');
    await page.waitForURL(/\/room\/.+/);

    // Click logo
    await page.click("text=BhayanakCast");

    // Should navigate to home
    await expect(page).toHaveURL("/");
  });
});
