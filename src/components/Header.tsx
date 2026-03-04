import { UserButton } from "@daveyplate/better-auth-ui";
import { Link } from "@tanstack/react-router";
import { Home, User, Users } from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { useWebSocket } from "#/lib/websocket-context";

export default function Sidebar() {
	const { data: session } = authClient.useSession();
	const { userCount, isConnected } = useWebSocket();

	return (
		<aside className="w-64 border-r border-border-subtle bg-depth-2 flex flex-col shrink-0">
			{/* Logo */}
			<div className="p-4 border-b border-border-subtle">
				<Link to="/" className="text-xl font-bold text-text-primary">
					BhayanakCast
				</Link>
			</div>

			{/* Navigation */}
			<nav className="flex-1 p-4 space-y-2">
				<Link
					to="/"
					className="flex items-center gap-3 px-3 py-2 rounded-lg text-text-secondary hover:bg-depth-3 hover:text-text-primary transition-colors"
					activeProps={{ className: "bg-depth-3 text-text-primary" }}
				>
					<Home className="h-5 w-5" />
					<span>Rooms</span>
				</Link>

				{session?.user?.id && (
					<Link
						to="/profile/$userId"
						params={{ userId: session.user.id }}
						className="flex items-center gap-3 px-3 py-2 rounded-lg text-text-secondary hover:bg-depth-3 hover:text-text-primary transition-colors"
						activeProps={{ className: "bg-depth-3 text-text-primary" }}
					>
						<User className="h-5 w-5" />
						<span>Profile</span>
					</Link>
				)}
			</nav>

			{/* Bottom section */}
			<div className="p-4 border-t border-border-subtle space-y-4">
				{/* Live User Count */}
				<div
					className="flex items-center gap-3 px-3 py-2 rounded-lg bg-depth-3 border border-border-subtle"
					title={isConnected ? `${userCount} users online` : "Connecting..."}
				>
					<Users
						className={`h-5 w-5 ${
							isConnected ? "text-green-400" : "text-gray-400"
						}`}
					/>
					<div className="flex-1">
						<p className="text-sm font-medium text-text-secondary">
							{isConnected ? userCount : "..."} online
						</p>
					</div>
					<span
						className={`h-2 w-2 rounded-full ${
							isConnected ? "bg-green-500 animate-pulse" : "bg-gray-500"
						}`}
					/>
				</div>

				{/* Auth */}
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
						className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
					>
						<User className="h-4 w-4" />
						<span>Sign In</span>
					</Link>
				)}
			</div>
		</aside>
	);
}
