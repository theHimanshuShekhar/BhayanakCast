import { Clock, Plus, Users } from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { TopConnectionsCard } from "./TopConnectionsCard";

function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

// Mock stats for now - can be replaced with real data later
const mockStats = {
	totalWatchTime: 86400, // 24 hours in seconds
	totalRoomsJoined: 12,
	totalConnections: 8,
};

export function UserStatsCard() {
	const { data: session } = authClient.useSession();

	// Don't render if user is not logged in
	if (!session?.user) {
		return null;
	}

	const user = session.user;

	return (
		<div className="hidden xl:block w-72 shrink-0">
			<div className="space-y-4">
				{/* User Profile Card */}
				<div className="bg-depth-1 rounded-xl border border-border-subtle p-5">
					<div className="flex items-center gap-4 mb-5">
						{user.image ? (
							<img
								src={user.image}
								alt={user.name}
								className="h-14 w-14 rounded-xl object-cover"
							/>
						) : (
							<div className="h-14 w-14 rounded-xl bg-accent/10 flex items-center justify-center">
								<span className="text-xl font-bold text-accent">
									{user.name?.charAt(0).toUpperCase() || "U"}
								</span>
							</div>
						)}
						<div className="flex-1 min-w-0">
							<h3 className="font-semibold text-text-primary truncate">
								{user.name}
							</h3>
						</div>
					</div>

					{/* Stats Grid */}
					<div className="grid grid-cols-1 gap-3">
						<div className="flex items-center gap-3 p-3 rounded-lg bg-depth-2">
							<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent/10">
								<Clock className="h-5 w-5 text-accent" />
							</div>
							<div>
								<p className="text-lg font-bold text-text-primary">
									{formatDuration(mockStats.totalWatchTime)}
								</p>
								<p className="text-xs text-text-tertiary">Total watch time</p>
							</div>
						</div>

						<div className="flex items-center gap-3 p-3 rounded-lg bg-depth-2">
							<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent/10">
								<Users className="h-5 w-5 text-accent" />
							</div>
							<div>
								<p className="text-lg font-bold text-text-primary">
									{mockStats.totalRoomsJoined}
								</p>
								<p className="text-xs text-text-tertiary">Rooms joined</p>
							</div>
						</div>

						<div className="flex items-center gap-3 p-3 rounded-lg bg-depth-2">
							<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent/10">
								<Users className="h-5 w-5 text-accent" />
							</div>
							<div>
								<p className="text-lg font-bold text-text-primary">
									{mockStats.totalConnections}
								</p>
								<p className="text-xs text-text-tertiary">Connections</p>
							</div>
						</div>
					</div>
				</div>

				{/* Create Room Button - Wide screens only */}
				<button
					type="button"
					className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-accent/20"
					onClick={() => alert("Create room feature coming soon!")}
				>
					<Plus className="h-5 w-5" />
					<span>Create Room</span>
				</button>

				{/* Top Connections */}
				<TopConnectionsCard />
			</div>
		</div>
	);
}
