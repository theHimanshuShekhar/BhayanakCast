import { createServerFn } from "@tanstack/react-start";
import { inArray, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "#/db/index";
import { accounts, users } from "#/db/schema";

/**
 * Test Authentication API
 *
 * These endpoints are ONLY available in test environment.
 * They allow E2E tests to programmatically create and manage test users.
 */

const TEST_EMAIL_DOMAIN = "test.example.com";
const TEST_PASSWORD = "testpassword123";

/**
 * Generate a random test email with "test" in it
 */
function generateTestEmail(): string {
	const randomId = nanoid(8);
	return `test-${randomId}@${TEST_EMAIL_DOMAIN}`;
}

/**
 * Sign up a new test user
 * POST /api/test/auth/signup
 */
export const testSignup = createServerFn({ method: "POST" })
	.inputValidator((data: { name: string }) => {
		if (process.env.NODE_ENV !== "test") {
			throw new Error(
				"Test auth endpoints are only available in test environment",
			);
		}
		return z.object({ name: z.string().min(1) }).parse(data);
	})
	.handler(async ({ data }) => {
		const email = generateTestEmail();
		const name = data.name;

		try {
			// Import auth here to avoid issues
			const { auth } = await import("#/lib/auth");

			// Use Better Auth's signUp method
			const result = await auth.api.signUpEmail({
				body: {
					email,
					password: TEST_PASSWORD,
					name,
				},
			});

			if (!result.token) {
				throw new Error("Failed to create test user");
			}

			return {
				success: true,
				userId: result.user.id,
				email,
				name,
				token: result.token,
			};
		} catch (error) {
			console.error("[Test Auth] Signup error:", error);
			throw new Error(
				`Failed to create test user: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	});

/**
 * Log in a test user
 * POST /api/test/auth/login
 */
export const testLogin = createServerFn({ method: "POST" })
	.inputValidator((data: { email: string }) => {
		if (process.env.NODE_ENV !== "test") {
			throw new Error(
				"Test auth endpoints are only available in test environment",
			);
		}
		return z.object({ email: z.string().email() }).parse(data);
	})
	.handler(async ({ data }) => {
		const { email } = data;

		try {
			// Verify this is a test email
			if (!email.includes("@test.") && !email.includes("test-")) {
				throw new Error("Can only login test users via this endpoint");
			}

			const { auth } = await import("#/lib/auth");

			const result = await auth.api.signInEmail({
				body: {
					email,
					password: TEST_PASSWORD,
				},
			});

			if (!result.token) {
				throw new Error("Login failed");
			}

			return {
				success: true,
				userId: result.user.id,
				email: result.user.email,
				name: result.user.name,
				token: result.token,
			};
		} catch (error) {
			console.error("[Test Auth] Login error:", error);
			throw new Error(
				`Login failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	});

/**
 * Clean up all test users
 * DELETE /api/test/auth/cleanup
 */
export const testCleanup = createServerFn({ method: "POST" })
	.inputValidator(() => {
		if (process.env.NODE_ENV !== "test") {
			throw new Error(
				"Test auth endpoints are only available in test environment",
			);
		}
		return {};
	})
	.handler(async () => {
		try {
			// Find all test users (emails containing "test" or with test domain)
			const testUsers = await db
				.select({ id: users.id })
				.from(users)
				.where(like(users.email, `%test%`));

			const userIds = testUsers.map((u) => u.id);

			if (userIds.length === 0) {
				return { success: true, deleted: 0 };
			}

			// Delete accounts first (foreign key constraint)
			await db.delete(accounts).where(inArray(accounts.userId, userIds));

			// Delete users
			await db.delete(users).where(inArray(users.id, userIds));

			console.log(`[Test Auth] Cleaned up ${userIds.length} test users`);

			return {
				success: true,
				deleted: userIds.length,
			};
		} catch (error) {
			console.error("[Test Auth] Cleanup error:", error);
			throw new Error(
				`Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	});
