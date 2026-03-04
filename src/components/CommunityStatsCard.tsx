import { Users } from "lucide-react";

interface CommunityStatsData {
	totalRegisteredUsers: number;
	totalWatchHoursThisWeek: number;
	mostActiveStreamers: number;
	newUsersThisWeek: number;
}

interface CommunityStatsCardProps {
	stats?: CommunityStatsData;
	isLoading?: boolean;
}

function CommunityStatsSkeleton() {
	return (
		<div className="space-y-3">
			{[1, 2, 3, 4].map((i) => (
				<div
					key={i}
					className="flex items-center justify-between p-2.5 rounded-lg bg-depth-2"
				>
					<div className="h-4 w-32 bg-depth-3 rounded animate-pulse" />
					<div className="h-5 w-16 bg-depth-3 rounded animate-pulse" />
				</div>
			))}
		</div>
	);
}

export function CommunityStatsCard({
	stats,
	isLoading,
}: CommunityStatsCardProps) {
	return (
		<div className="bg-depth-1 rounded-xl border border-border-subtle p-5">
			<div className="flex items-center gap-2 mb-4">
				<Users className="h-5 w-5 text-accent" />
				<h3 className="font-semibold text-text-primary">Community</h3>
			</div>
			{isLoading || !stats ? (
				<CommunityStatsSkeleton />
			) : (
				<div className="space-y-3">
					<div className="flex items-center justify-between p-2.5 rounded-lg bg-depth-2">
						<span className="text-sm text-text-secondary">Total Users</span>
						<span className="text-lg font-bold text-accent">
							{stats.totalRegisteredUsers.toLocaleString()}
						</span>
					</div>
					<div className="flex items-center justify-between p-2.5 rounded-lg bg-depth-2">
						<span className="text-sm text-text-secondary">
							Watch Hours (Week)
						</span>
						<span className="text-lg font-bold text-accent">
							{stats.totalWatchHoursThisWeek.toLocaleString()}h
						</span>
					</div>
					<div className="flex items-center justify-between p-2.5 rounded-lg bg-depth-2">
						<span className="text-sm text-text-secondary">
							Active Streamers
						</span>
						<span className="text-lg font-bold text-accent">
							{stats.mostActiveStreamers}
						</span>
					</div>
					<div className="flex items-center justify-between p-2.5 rounded-lg bg-depth-2">
						<span className="text-sm text-text-secondary">New This Week</span>
						<span className="text-lg font-bold text-success">
							+{stats.newUsersThisWeek}
						</span>
					</div>
				</div>
			)}
		</div>
	);
}
