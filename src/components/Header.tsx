import { UserButton } from "@daveyplate/better-auth-ui";
import { Link } from "@tanstack/react-router";
import { User, Users } from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { useWebSocket } from "#/lib/websocket-context";

export default function Header() {
	const { data: session } = authClient.useSession();
	const { userCount, isConnected } = useWebSocket();

	return (
		<header className="border-b border-border-subtle bg-depth-2 px-4 py-3 shrink-0">
			<nav className="mx-auto flex max-w-7xl items-center justify-between">
				<Link to="/" className="text-xl font-bold text-text-primary">
					BhayanakCast
				</Link>
				<div className="flex items-center gap-4">
					{/* Live User Count */}
					<div
						className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-depth-3 border border-border-subtle"
						title={isConnected ? `${userCount} users online` : "Connecting..."}
					>
						<Users
							className={`h-4 w-4 ${
								isConnected ? "text-green-400" : "text-gray-400"
							}`}
						/>
						<span className="text-sm font-medium text-text-secondary min-w-[1.5rem] text-center">
							{isConnected ? userCount : "..."}
						</span>
						<span
							className={`h-2 w-2 rounded-full ${
								isConnected ? "bg-green-500 animate-pulse" : "bg-gray-500"
							}`}
						/>
					</div>

					{session?.user?.id ? (
						<UserButton
							size="sm"
							disableDefaultLinks
							additionalLinks={[
								{
									label: "Profile",
									href: `/profile/${session.user.id}`,
									icon: <User className="h-4 w-4" />,
								},
							]}
						/>
					) : (
						<Link
							to="/auth/$authView"
							params={{ authView: "sign-in" }}
							className="text-text-primary hover:text-accent transition-colors"
						>
							Sign In
						</Link>
					)}
				</div>
			</nav>
		</header>
	);
}
