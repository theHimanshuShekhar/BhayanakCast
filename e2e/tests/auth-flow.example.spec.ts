/**
 * Example E2E Test with Test Authentication
 * 
 * This demonstrates how to use the test auth utilities to create
 * multiple test users for scenarios like streamer + viewer interactions.
 */

import { test, expect } from "../utils/auth";

test.describe("Example: Streamer and Viewer Test Flow", () => {
	test("streamer can create room and viewer can join", async ({
		browser,
		signupTestUser,
	}) => {
		// Create two test users
		const streamer = await signupTestUser("Test Streamer");
		const viewer = await signupTestUser("Test Viewer");

		console.log(`[Test] Created streamer: ${streamer.email}`);
		console.log(`[Test] Created viewer: ${viewer.email}`);

		// Create authenticated contexts for both users
		const streamerContext = await browser.newContext({
			storageState: {
				cookies: [
					{
						name: "auth-token",
						value: streamer.token,
						domain: "localhost",
						path: "/",
						expires: Date.now() / 1000 + 3600,
						httpOnly: true,
						secure: false,
						sameSite: "Lax",
					},
				],
				origins: [],
			},
		});

		const viewerContext = await browser.newContext({
			storageState: {
				cookies: [
					{
						name: "auth-token",
						value: viewer.token,
						domain: "localhost",
						path: "/",
						expires: Date.now() / 1000 + 3600,
						httpOnly: true,
						secure: false,
						sameSite: "Lax",
					},
				],
				origins: [],
			},
		});

		const streamerPage = await streamerContext.newPage();
		const viewerPage = await viewerContext.newPage();

		try {
			// Streamer creates a room
			await streamerPage.goto("/");
			await streamerPage.click('button:has-text("Create Room")');
			await streamerPage.fill(
				'input[name="name"]',
				"Test Stream Room",
			);
			await streamerPage.fill(
				'textarea[name="description"]',
				"A test room for E2E testing",
			);
			await streamerPage.click(
				'button[type="submit"]:has-text("Create Room")',
			);
			await streamerPage.waitForURL(/\/room\/.+/);

			const roomUrl = streamerPage.url();
			console.log(`[Test] Room created: ${roomUrl}`);

			// Verify streamer is in the room
			await expect(streamerPage.locator("h1")).toContainText(
				"Test Stream Room",
			);

			// Viewer joins the room
			await viewerPage.goto(roomUrl);

			// Verify viewer is also in the room
			await expect(viewerPage.locator("h1")).toContainText("Test Stream Room");

			// Verify both users see each other
			await expect(streamerPage.locator("text=1 viewers")).toBeVisible();
			await expect(viewerPage.locator("text=1 viewers")).toBeVisible();

			console.log("[Test] Both users successfully joined the room!");
		} finally {
			// Cleanup contexts
			await streamerContext.close();
			await viewerContext.close();
		}
	});

	test("multiple viewers can join a stream", async ({ browser, signupTestUser }) => {
		// Create streamer and multiple viewers
		const streamer = await signupTestUser("Streamer");
		const viewer1 = await signupTestUser("Viewer1");
		const viewer2 = await signupTestUser("Viewer2");

		const contexts: Array<{ close: () => Promise<void> }> = [];

		try {
			// Helper to create authenticated context
			const createContext = async (user: { token: string }) => {
				const context = await browser.newContext({
					storageState: {
						cookies: [
							{
								name: "auth-token",
								value: user.token,
								domain: "localhost",
								path: "/",
								expires: Date.now() / 1000 + 3600,
								httpOnly: true,
								secure: false,
								sameSite: "Lax",
							},
						],
						origins: [],
					},
				});
				contexts.push(context);
				return context;
			};

			// Create all contexts
			const streamerCtx = await createContext(streamer);
			const viewer1Ctx = await createContext(viewer1);
			const viewer2Ctx = await createContext(viewer2);

			const streamerPage = await streamerCtx.newPage();
			const viewer1Page = await viewer1Ctx.newPage();
			const viewer2Page = await viewer2Ctx.newPage();

			// Streamer creates room
			await streamerPage.goto("/");
			await streamerPage.click('button:has-text("Create Room")');
			await streamerPage.fill(
				'input[name="name"]',
				"Multi Viewer Test",
			);
			await streamerPage.click(
				'button[type="submit"]:has-text("Create Room")',
			);
			await streamerPage.waitForURL(/\/room\/.+/);

			const roomUrl = streamerPage.url();

			// Both viewers join
			await viewer1Page.goto(roomUrl);
			await viewer2Page.goto(roomUrl);

			// Verify all see 2 viewers
			await expect(streamerPage.locator("text=2 viewers")).toBeVisible();
			await expect(viewer1Page.locator("text=2 viewers")).toBeVisible();
			await expect(viewer2Page.locator("text=2 viewers")).toBeVisible();

			console.log("[Test] Multi-viewer test passed!");
		} finally {
			// Cleanup all contexts
			for (const context of contexts) {
				await context.close();
			}
		}
	});
});
