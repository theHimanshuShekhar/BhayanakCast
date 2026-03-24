/**
 * E2E Test Authentication Utilities
 *
 * Helper functions for creating and managing test users in E2E tests.
 * Each test can create its own independent test users.
 *
 * ⚠️ IMPORTANT: All authentication must use UI-based login.
 * Better Auth requires actual UI login flow - cookie injection does not work.
 *
 * @example
 * ```typescript
 * import { test, expect, loginUser, TEST_VIEWPORT } from "../utils/auth";
 *
 * test("example", async ({ page, signupTestUser }) => {
 *   const user = await signupTestUser("Test User");
 *   await loginUser(page, user.email);
 *   await page.setViewportSize(TEST_VIEWPORT);
 *   // ... test code
 * });
 * ```
 */

import { test as baseTest, type Page, type APIRequestContext } from "@playwright/test";

const TEST_AUTH_BASE_URL = process.env.BASE_URL || "http://localhost:3000";

/**
 * Standard viewport for E2E tests.
 * Set AFTER login to ensure Create Room button is visible.
 */
export const TEST_VIEWPORT = { width: 1200, height: 800 };

/**
 * Default password for all test users
 */
export const TEST_USER_PASSWORD = "testpassword123";

export interface TestUser {
  userId: string;
  email: string;
  name: string;
  token: string;
}

/**
 * Sign up a new test user via the test auth API
 */
export async function signupTestUser(
  request: APIRequestContext,
  name: string
): Promise<TestUser> {
  const response = await request.post(`${TEST_AUTH_BASE_URL}/api/test/auth/signup`, {
    data: { name },
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok()) {
    const error = await response.text();
    throw new Error(`Failed to signup test user: ${error}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(`Signup failed: ${data.error || "Unknown error"}`);
  }

  return {
    userId: data.userId,
    email: data.email,
    name: data.name,
    token: data.token,
  };
}

/**
 * Log in an existing test user via the test auth API
 */
export async function loginTestUser(
  request: APIRequestContext,
  email: string
): Promise<TestUser> {
  const response = await request.post(`${TEST_AUTH_BASE_URL}/api/test/auth/login`, {
    data: { email },
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok()) {
    const error = await response.text();
    throw new Error(`Failed to login test user: ${error}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(`Login failed: ${data.error || "Unknown error"}`);
  }

  return {
    userId: data.userId,
    email: data.email,
    name: data.name,
    token: data.token,
  };
}

/**
 * Login a test user via UI.
 *
 * ⚠️ CRITICAL: This must be used instead of cookie-based auth.
 * Better Auth requires actual UI login flow.
 *
 * @param page - Playwright page object
 * @param email - Test user email
 * @param password - Test user password (defaults to TEST_USER_PASSWORD)
 *
 * @example
 * ```typescript
 * const user = await signupTestUser("Test User");
 * await loginUser(page, user.email);
 * await page.setViewportSize(TEST_VIEWPORT); // Set AFTER login
 * ```
 */
export async function loginUser(
	page: Page,
	email: string,
	password: string = TEST_USER_PASSWORD
): Promise<void> {
	await page.goto("/auth/sign-in");
	await page.waitForLoadState("networkidle");
	await page.waitForTimeout(1000); // Wait for React hydration

	// Try multiple selectors - Better Auth uses shadcn/ui components
	// which may not have standard type attributes
	const emailInput = page.locator('input').first();
	const passwordInput = page.locator('input').nth(1);
	const submitButton = page.locator('button:has-text("Login")');

	await emailInput.waitFor({ state: "visible", timeout: 5000 });
	await emailInput.fill(email);
	await passwordInput.fill(password);
	await submitButton.click();

	// Wait for navigation to home page after successful login
	// Use a longer timeout as auth can be slow
	await page.waitForURL("http://localhost:3000/", { timeout: 15000 });
	await page.waitForLoadState("networkidle");
	await page.waitForTimeout(1000); // Wait for React hydration
}

/**
 * Clean up all test users via the test auth API
 * Call this in globalTeardown or after each test suite
 */
export async function cleanupAllTestUsers(
  request: APIRequestContext
): Promise<void> {
  const response = await request.post(`${TEST_AUTH_BASE_URL}/api/test/auth/cleanup`, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok()) {
    const error = await response.text();
    console.error(`[Test Cleanup] Failed to cleanup test users: ${error}`);
    // Don't throw - cleanup failures shouldn't fail tests
  }
}

/**
 * Extended test fixture with test user utilities
 */
export const test = baseTest.extend<{
  signupTestUser: (name: string) => Promise<TestUser>;
  cleanupTestUsers: () => Promise<void>;
}>({
  // Provide signup function as fixture
  signupTestUser: async ({ request }, use) => {
    await use((name: string) => signupTestUser(request, name));
  },

  // Provide cleanup function as fixture
  cleanupTestUsers: async ({ request }, use) => {
    await use(() => cleanupAllTestUsers(request));
  },
});

export { expect } from "@playwright/test";
