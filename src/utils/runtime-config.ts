import { createServerFn } from "@tanstack/react-start";

/**
 * Get runtime configuration from server environment variables.
 * This allows the same built image to work in different environments
 * without needing to rebuild for each environment.
 */
export const getRuntimeConfig = createServerFn({ method: "GET" }).handler(
	async () => {
		return {
			// WebSocket server URL
			wsUrl: process.env.VITE_WS_URL || "http://localhost:3001",
			// Better Auth URL
			authUrl: process.env.VITE_BETTER_AUTH_URL || "http://localhost:3000",
			// PostHog configuration (optional)
			posthogKey: process.env.VITE_POSTHOG_KEY,
			posthogHost: process.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
		};
	},
);
