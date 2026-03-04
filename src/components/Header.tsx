import { UserButton } from "@daveyplate/better-auth-ui";
import { Link } from "@tanstack/react-router";
import { PanelLeft, User, Users } from "lucide-react";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { useWebSocket } from "#/lib/websocket-context";
import { ThemeSwitcher } from "./ThemeSwitcher";

function formatCompactNumber(num: number): string {
	if (num >= 1000000) {
		return `${(num / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
	}
	if (num >= 1000) {
		return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}K`;
	}
	return num.toString();
}

export default function Sidebar() {
	const { data: session } = authClient.useSession();
	const { userCount, isConnected } = useWebSocket();
	const [isExpanded, setIsExpanded] = useState(false);

	const toggleSidebar = () => setIsExpanded(!isExpanded);

	const displayCount = isConnected ? formatCompactNumber(userCount) : "...";
	const displayCountWithLabel = isConnected
		? `${formatCompactNumber(userCount)} ${userCount === 1 ? "User" : "Users"}`
		: "...";

	return (
		<aside
			className={`border-r border-border-subtle bg-depth-1 flex flex-col shrink-0 transition-all duration-300 ease-in-out ${
				isExpanded ? "w-60" : "w-16"
			}`}
		>
			{/* Section 1: Brand Logo */}
			<div className="p-4">
				<div className={isExpanded ? "" : "flex justify-center"}>
					{isExpanded ? (
						<Link
							to="/"
							className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-depth-2 transition-colors"
						>
							<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent/10 text-accent font-bold text-xl">
								BC
							</div>
							<div className="flex flex-col">
								<span className="font-bold text-text-primary text-lg leading-tight">
									Bhayanak
								</span>
								<span className="font-bold text-accent text-lg leading-tight -mt-1">
									Cast
								</span>
							</div>
						</Link>
					) : (
						<div className="w-12 h-12">
							<Link
								to="/"
								className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent/10 text-accent font-bold text-xl hover:bg-accent/20 transition-colors"
								title="BhayanakCast"
							>
								BC
							</Link>
						</div>
					)}
				</div>
			</div>

			{/* Section 2: Online Count and Theme Switcher */}
			<div className="px-4 pb-4 space-y-3">
				{/* Divider */}
				<div className="h-px bg-border-subtle" />

				{/* User Count Section */}
				<div className={isExpanded ? "" : "flex justify-center"}>
					{isExpanded ? (
						<div
							className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-depth-2 border border-border-subtle hover:border-border-default transition-colors cursor-pointer group"
							title={
								isConnected ? `${userCount} users online` : "Connecting..."
							}
						>
							<div className="relative shrink-0">
								<Users
									className={`h-5 w-5 ${
										isConnected ? "text-success" : "text-text-tertiary"
									}`}
								/>
								<span
									className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-depth-2 ${
										isConnected ? "bg-success" : "bg-text-tertiary"
									}`}
								/>
							</div>
							<div className="flex flex-col min-w-0">
								<span className="text-sm font-semibold text-text-primary">
									{displayCountWithLabel}
								</span>
								<span className="text-xs text-text-tertiary truncate">
									online
								</span>
							</div>
						</div>
					) : (
						<div className="w-12 h-12">
							<div
								className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-depth-2 border border-border-subtle hover:border-border-default transition-colors cursor-pointer group"
								title={
									isConnected ? `${userCount} users online` : "Connecting..."
								}
							>
								<div className="relative">
									<Users
										className={`h-5 w-5 ${
											isConnected ? "text-success" : "text-text-tertiary"
										}`}
									/>
									<span
										className={`absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border-2 border-depth-2 ${
											isConnected ? "bg-success" : "bg-text-tertiary"
										}`}
									/>
								</div>
								<span className="text-[10px] font-semibold text-text-secondary mt-0.5">
									{displayCount}
								</span>
							</div>
						</div>
					)}
				</div>

				{/* Theme Switcher */}
				<div className={isExpanded ? "" : "flex justify-center"}>
					{isExpanded ? (
						<ThemeSwitcher isExpanded={isExpanded} />
					) : (
						<div className="w-12 h-12">
							<ThemeSwitcher isExpanded={isExpanded} />
						</div>
					)}
				</div>
			</div>

			{/* Spacer */}
			<div className="flex-1" />

			{/* Section 3: UserButton and Sidebar toggle */}
			<div className="p-4 space-y-3">
				{/* Divider */}
				<div className="h-px bg-border-subtle" />

				{/* Auth */}
				<div>
					{session?.user?.id ? (
						<div className={isExpanded ? "" : "flex justify-center"}>
							{isExpanded ? (
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
								<div className="w-12 h-12">
									<UserButton
										size="icon"
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
							)}
						</div>
					) : isExpanded ? (
						<Link
							to="/auth/$authView"
							params={{ authView: "sign-in" }}
							className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-accent/20"
						>
							<User className="h-4 w-4" />
							<span>Sign In</span>
						</Link>
					) : (
						<div className={isExpanded ? "" : "flex justify-center"}>
							<div className="w-12 h-12">
								<Link
									to="/auth/$authView"
									params={{ authView: "sign-in" }}
									className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.05] active:scale-[0.95] shadow-lg shadow-accent/20"
									title="Sign In"
								>
									<User className="h-5 w-5" />
								</Link>
							</div>
						</div>
					)}
				</div>

				{/* Toggle Button */}
				<div className={isExpanded ? "" : "flex justify-center"}>
					<button
						type="button"
						onClick={toggleSidebar}
						className={`flex items-center justify-center rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${
							isExpanded
								? "w-full px-4 py-2.5 gap-2 hover:bg-depth-2 text-text-secondary hover:text-text-primary"
								: "w-12 h-12 hover:bg-depth-2 text-text-secondary hover:text-text-primary"
						}`}
						title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
					>
						<PanelLeft
							className={`h-5 w-5 transition-transform duration-300 ${
								isExpanded ? "" : "rotate-180"
							}`}
						/>
						{isExpanded && (
							<span className="text-sm font-medium">Collapse</span>
						)}
					</button>
				</div>
			</div>
		</aside>
	);
}
