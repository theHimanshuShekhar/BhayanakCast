import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { testCleanup, testLogin, testSignup } from "#/utils/test-auth";

/**
 * Test Authentication API Routes
 *
 * POST /api/test/auth/signup - Create a new test user
 * POST /api/test/auth/login - Login a test user
 * POST /api/test/auth/cleanup - Delete all test users
 *
 * These endpoints are ONLY available in NODE_ENV=test
 */

export const Route = createFileRoute("/api/test/auth/$")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				// Check environment
				if (process.env.NODE_ENV !== "test") {
					return json(
						{
							error:
								"Test auth endpoints are only available in test environment",
						},
						{ status: 403 },
					);
				}

				const url = new URL(request.url);
				const path = url.pathname.replace("/api/test/auth/", "");

				try {
					const body = await request.json();

					switch (path) {
						case "signup": {
							const result = await testSignup({ data: body });
							return json(result);
						}
						case "login": {
							const result = await testLogin({ data: body });
							return json(result);
						}
						case "cleanup": {
							const result = await testCleanup({ data: {} });
							return json(result);
						}
						default:
							return json({ error: "Unknown endpoint" }, { status: 404 });
					}
				} catch (error) {
					console.error("[Test Auth API] Error:", error);
					return json(
						{ error: error instanceof Error ? error.message : "Unknown error" },
						{ status: 500 },
					);
				}
			},
		},
	},
});
