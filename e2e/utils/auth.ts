/**
 * E2E Test Authentication Utilities
 *
 * Helper functions for creating and managing test users in E2E tests.
 * Each test can create its own independent test users.
 */

import { test as baseTest, type Page, type APIRequestContext } from "@playwright/test";

const TEST_AUTH_BASE_URL = process.env.BASE_URL || "http://localhost:3000";

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
 * Create an authenticated page context for a test user
 */
export async function createAuthenticatedContext(
  browser: any,
  user: TestUser
): Promise<{ context: any; page: Page }> {
  const context = await browser.newContext({
    storageState: {
      cookies: [
        {
          name: "better-auth.session_token",
          value: user.token,
          domain: "localhost",
          path: "/",
          expires: Date.now() / 1000 + 3600, // 1 hour
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  });

  const page = await context.newPage();
  
  return { context, page };
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
