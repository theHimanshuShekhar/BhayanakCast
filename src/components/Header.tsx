import { UserButton } from "@daveyplate/better-auth-ui";
import { Link } from "@tanstack/react-router";
import { PanelLeft, User, Users } from "lucide-react";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { useWebSocket } from "#/lib/websocket-context";

export default function Sidebar() {
	const { data: session } = authClient.useSession();
	const { userCount, isConnected } = useWebSocket();
	const [isExpanded, setIsExpanded] = useState(false);

	const toggleSidebar = () => setIsExpanded(!isExpanded);

	return (
		<aside
			className={`border-r border-border-subtle bg-depth-2 flex flex-col shrink-0 transition-all duration-300 ${
				isExpanded ? "w-64" : "w-16"
			}`}
		>
			{/* Toggle Button */}
			<div className="p-3 border-b border-border-subtle">
				<button
					type="button"
					onClick={toggleSidebar}
					className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-depth-3 text-text-secondary hover:text-text-primary transition-colors"
					title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
				>
					<PanelLeft
						className={`h-5 w-5 transition-transform duration-300 ${
							isExpanded ? "" : "rotate-180"
						}`}
					/>
				</button>
			</div>

			{/* Logo - show text only when expanded */}
			<div className="p-3 border-b border-border-subtle">
				{isExpanded ? (
					<Link
						to="/"
						className="text-lg font-bold text-text-primary truncate block"
					>
						BhayanakCast
					</Link>
				) : (
					<Link
						to="/"
						className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-depth-3 text-text-primary font-bold"
						title="BhayanakCast"
					>
						B
					</Link>
				)}
			</div>

			{/* User Count */}
			<div className="p-3 border-b border-border-subtle">
				{isExpanded ? (
					<div
						className="flex items-center gap-2 px-3 py-2 rounded-lg bg-depth-3 border border-border-subtle"
						title={isConnected ? `${userCount} users online` : "Connecting..."}
					>
						<Users
							className={`h-4 w-4 ${
								isConnected ? "text-green-400" : "text-gray-400"
							}`}
						/>
						<span className="text-sm font-medium text-text-secondary">
							{isConnected ? userCount : "..."} online
						</span>
						<span
							className={`ml-auto h-2 w-2 rounded-full ${
								isConnected ? "bg-green-500 animate-pulse" : "bg-gray-500"
							}`}
						/>
					</div>
				) : (
					<div
						className="flex flex-col items-center justify-center w-10 h-10 rounded-lg bg-depth-3 border border-border-subtle gap-0.5"
						title={isConnected ? `${userCount} users online` : "Connecting..."}
					>
						<Users
							className={`h-3 w-3 ${
								isConnected ? "text-green-400" : "text-gray-400"
							}`}
						/>
						<span className="text-xs font-medium text-text-secondary leading-none">
							{isConnected ? userCount : "..."}
						</span>
					</div>
				)}
			</div>

			{/* Spacer */}
			<div className="flex-1" />

			{/* Auth */}
			<div className="p-3 border-t border-border-subtle">
				{session?.user?.id ? (
					<div className={`flex ${isExpanded ? "" : "justify-center"}`}>
						<UserButton
							size={isExpanded ? "sm" : "icon"}
							disableDefaultLinks
							additionalLinks={[
								{
									label: "Profile",
									href: `/profile/${session.user.id}`,
									icon: <User className="h-4 w-4" />,
								},
							]}
						/>
					</div>
				) : isExpanded ? (
					<Link
						to="/auth/$authView"
						params={{ authView: "sign-in" }}
						className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
					>
						<User className="h-4 w-4" />
						<span>Sign In</span>
					</Link>
				) : (
					<Link
						to="/auth/$authView"
						params={{ authView: "sign-in" }}
						className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent hover:bg-accent-hover text-white transition-colors"
						title="Sign In"
					>
						<User className="h-5 w-5" />
					</Link>
				)}
			</div>
		</aside>
	);
}
