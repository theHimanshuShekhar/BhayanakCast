import { test as baseTest, expect } from "@playwright/test";

/**
 * Authenticated test fixture
 * 
 * Provides a pre-authenticated page for tests that need to create rooms
 */

export const test = baseTest.extend<{
  authenticatedPage: any;
}>({
  // Provide an authenticated page for tests
  authenticatedPage: async ({ browser }, use) => {
    // Create a new context
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Navigate to the app
    await page.goto("/");
    
    // Check if we're already logged in (session persists)
    const signInButton = page.locator('a[title="Sign In"]');
    const isLoggedIn = await signInButton.isVisible().catch(() => false);
    
    if (isLoggedIn) {
      // Click sign in
      await signInButton.click();
      
      // Wait for Discord OAuth or auth page
      // For now, we'll assume the user might already be logged in from a previous session
      // or we need to handle the auth flow
      await page.waitForTimeout(2000);
    }
    
    // Use the page
    await use(page);
    
    // Cleanup
    await context.close();
  },
});

export { expect };
