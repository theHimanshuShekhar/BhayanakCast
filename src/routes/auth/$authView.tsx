import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/auth/$authView")({
	component: RouteComponent,
});

function RouteComponent() {
	const [isLoading, setIsLoading] = useState(false);

	const handleDiscordLogin = async () => {
		setIsLoading(true);
		try {
			await authClient.signIn.social({
				provider: "discord",
				callbackURL: "/",
			});
		} catch (error) {
			console.error("Discord login error:", error);
			setIsLoading(false);
		}
	};

	return (
		<main className="flex h-full w-full items-center justify-center bg-depth-0 p-4">
			<div className="w-full max-w-md rounded-xl border border-border-subtle bg-depth-1 p-8">
				<div className="mb-8 text-center">
					<h1 className="mb-2 text-2xl font-bold text-text-primary">
						Welcome to BhayanakCast
					</h1>
					<p className="text-text-secondary">
						Sign in with Discord to continue
					</p>
				</div>

				<button
					type="button"
					onClick={handleDiscordLogin}
					disabled={isLoading}
					className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#5865F2] px-4 py-3 font-semibold text-white transition-all hover:bg-[#4752C4] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
				>
					<MessageSquare className="h-5 w-5" />
					{isLoading ? "Connecting..." : "Continue with Discord"}
				</button>
			</div>
		</main>
	);
}
