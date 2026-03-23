import { useQuery } from "@tanstack/react-query";
import { Clock, Plus, Users } from "lucide-react";
import { CreateRoomModal } from "#/components/CreateRoomModal";
import { authClient } from "#/lib/auth-client";
import { getUserHomeStats } from "#/utils/home";
import { CommunityStatsCard } from "./CommunityStatsCard";
import { TopConnectionsCard } from "./TopConnectionsCard";

function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

function StatsSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-3">
			{[1, 2, 3].map((i) => (
				<div
					key={i}
					className="flex items-center gap-3 p-3 rounded-lg bg-depth-2"
				>
					<div className="h-10 w-10 rounded-lg bg-depth-3 animate-pulse" />
					<div className="flex-1 space-y-2">
						<div className="h-5 w-16 bg-depth-3 rounded animate-pulse" />
						<div className="h-3 w-24 bg-depth-3 rounded animate-pulse" />
					</div>
				</div>
			))}
		</div>
	);
}

export function UserStatsCard() {
	const { data: session } = authClient.useSession();

	// Fetch user stats and community stats
	const { data: statsData, isLoading } = useQuery<{
		userStats: {
			totalWatchTime: number;
			totalRoomsJoined: number;
			totalConnections: number;
		};
		communityStats: {
			totalRegisteredUsers: number;
			totalWatchHoursThisWeek: number;
			mostActiveStreamers: number;
			newUsersThisWeek: number;
			totalWatchSecondsThisWeek: number;
		};
	} | null>({
		queryKey: ["userHomeStats", session?.user?.id],
		queryFn: async () => {
			if (!session?.user?.id) return null;
			return getUserHomeStats({ data: { userId: session.user.id } });
		},
		enabled: !!session?.user?.id,
		staleTime: 30 * 60 * 1000, // 30 minutes
	});

	// Don't render if user is not logged in
	if (!session?.user) {
		return null;
	}

	const user = session.user;
	const userStats = statsData?.userStats;
	const communityStats = statsData?.communityStats;

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
					{isLoading || !userStats ? (
						<StatsSkeleton />
					) : (
						<div className="grid grid-cols-1 gap-3">
							<div className="flex items-center gap-3 p-3 rounded-lg bg-depth-2">
								<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent/10">
									<Clock className="h-5 w-5 text-accent" />
								</div>
								<div>
									<p className="text-lg font-bold text-text-primary">
										{formatDuration(userStats.totalWatchTime)}
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
										{userStats.totalRoomsJoined}
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
										{userStats.totalConnections}
									</p>
									<p className="text-xs text-text-tertiary">Connections</p>
								</div>
							</div>
						</div>
					)}
				</div>

				{/* Create Room Button - Wide screens only */}
				<CreateRoomModal>
					<button
						type="button"
						className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-accent/20"
					>
						<Plus className="h-5 w-5" />
						<span>Create Room</span>
					</button>
				</CreateRoomModal>

				{/* Top Connections */}
				<TopConnectionsCard />

				{/* Community Stats - Show if has data */}
				{communityStats && communityStats.totalRegisteredUsers > 0 && (
					<CommunityStatsCard stats={communityStats} isLoading={isLoading} />
				)}
			</div>
		</div>
	);
}
