import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const getSessionOnServer = createServerFn({ method: "GET" }).handler(
	async () => {
		// Dynamic import to avoid bundling for client
		const { auth } = await import("#/lib/auth");
		const session = await auth.api.getSession({
			headers: new Headers(),
		});
		return session;
	},
);

/**
 * Use this in route definitions to protect routes that require authentication.
 *
 * Example:
 * export const Route = createFileRoute("/protected")({
 *   component: ProtectedPage,
 *   beforeLoad: requireAuth,
 * });
 */
export async function requireAuth() {
	const session = await getSessionOnServer();

	if (!session) {
		throw redirect({
			to: "/auth/$authView",
			params: { authView: "sign-in" },
			search: {
				redirect:
					typeof window !== "undefined" ? window.location.pathname : "/",
			},
		});
	}

	return { user: session.user };
}

/**
 * Use this for routes that should be accessible to everyone.
 * This is just for explicit documentation - routes without beforeLoad are public by default.
 */
export function publicRoute() {
	return {};
}
