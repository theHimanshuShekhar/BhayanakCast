import { createServerFn } from "@tanstack/react-start";

export const getSessionOnServer = createServerFn({ method: "GET" }).handler(
	async () => {
		// Dynamic import to avoid bundling for client
		const { auth } = await import("#/lib/auth");
		const session = await auth.api.getSession({
			headers: new Headers(),
		});
		return session;
	},
);
