import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client configuration.
 *
 * Note: We don't bake the baseURL at build time.
 * The auth client defaults to the current origin (window.location.origin),
 * which works perfectly since the auth API is on the same domain as the app.
 *
 * This allows the same Docker image to work in any environment without rebuilding.
 */
export const authClient = createAuthClient({
	// Empty baseURL defaults to current origin
	// This works because auth endpoints are at /api/auth/*
});
