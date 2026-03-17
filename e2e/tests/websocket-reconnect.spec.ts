import { test, expect } from "@playwright/test";

test.describe("WebSocket Reconnection", () => {
	test("reconnects and rejoins room after connection loss", async ({ page }) => {
		// Create and join room
		await page.goto("/");
		await page.click('button:has-text("Create Room")');
		await page.fill('input[name="name"]', "Reconnect Test Room");
		await page.click('button[type="submit"]:has-text("Create Room")');
		await page.waitForURL(/\/room\/.+/);

		// Simulate disconnect by going offline
		await page.context().setOffline(true);
		await page.waitForTimeout(2000);

		// Go back online
		await page.context().setOffline(false);

		// Should automatically rejoin
		await expect(page.locator("h1")).toContainText("Reconnect Test Room");
	});

	test("multiple users handle reconnection", async ({ browser }) => {
		const context1 = await browser.newContext();
		const page1 = await context1.newPage();

		await page1.goto("/");
		await page1.click('button:has-text("Create Room")');
		await page1.fill('input[name="name"]', "Multi Reconnect Test");
		await page1.click('button[type="submit"]:has-text("Create Room")');
		await page1.waitForURL(/\/room\/.+/);

		const context2 = await browser.newContext();
		const page2 = await context2.newPage();
		await page2.goto(page1.url());

		// Disconnect user 2
		await context2.setOffline(true);
		await page2.waitForTimeout(1000);

		// Reconnect user 2
		await context2.setOffline(false);

		// Both should see each other
		await expect(page1.locator("text=1 viewers")).toBeVisible();
		await expect(page2.locator("text=1 viewers")).toBeVisible();

		await context1.close();
		await context2.close();
	});
});
