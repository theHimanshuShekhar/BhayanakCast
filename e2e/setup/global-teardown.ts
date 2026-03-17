/**
 * Global Teardown for Playwright E2E Tests
 *
 * Cleans up all test users after the test suite completes.
 */

import { request } from "@playwright/test";

const TEST_AUTH_BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function globalTeardown() {
  console.log("[Global Teardown] Cleaning up test users...");

  try {
    const apiContext = await request.newContext();
    
    const response = await apiContext.post(`${TEST_AUTH_BASE_URL}/api/test/auth/cleanup`, {
      data: {},
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok()) {
      const result = await response.json();
      console.log(`[Global Teardown] Cleaned up ${result.deleted || 0} test users`);
    } else {
      const error = await response.text();
      console.error(`[Global Teardown] Failed to cleanup: ${error}`);
    }

    await apiContext.dispose();
  } catch (error) {
    console.error("[Global Teardown] Error during cleanup:", error);
    // Don't throw - teardown failures shouldn't fail the test suite
  }
}

export default globalTeardown;
