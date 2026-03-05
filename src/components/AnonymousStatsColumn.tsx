import { Link } from "@tanstack/react-router";
import { Activity, Clock, Flame, Radio, TrendingUp, Users } from "lucide-react";
import { useWebSocket } from "#/lib/websocket-context";
import { CommunityStatsCard } from "./CommunityStatsCard";

interface AnonymousStatsColumnProps {
	trendingRooms: Array<{
		id: string;
		name: string;
		streamerName: string | null;
		viewerCount: number;
	}>;
	communityStats: {
		totalRegisteredUsers: number;
		totalWatchHoursThisWeek: number;
		mostActiveStreamers: number;
		newUsersThisWeek: number;
	};
	globalStats: {
		totalRoomsCreated: number;
		totalHoursStreamedToday: number;
		peakConcurrentUsers: number;
	};
}

export function AnonymousStatsColumn({
	trendingRooms,
	communityStats,
	globalStats,
}: AnonymousStatsColumnProps) {
	const { userCount } = useWebSocket();
	return (
		<div className="hidden xl:block w-72 shrink-0 space-y-4">
			{/* Card 1: Global Site Stats - Show if has data */}
			{globalStats.totalRoomsCreated > 0 && (
				<div className="bg-depth-1 rounded-xl border border-border-subtle p-5">
					<div className="flex items-center gap-2 mb-4">
						<Activity className="h-5 w-5 text-success" />
						<h3 className="font-semibold text-text-primary">Global Stats</h3>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="p-2.5 rounded-lg bg-depth-2">
							<div className="flex items-center gap-1.5 mb-1">
								<Users className="h-3.5 w-3.5 text-accent" />
								<span className="text-xs text-text-tertiary">Online</span>
							</div>
							<span className="text-lg font-bold text-text-primary">
								{userCount.toLocaleString()}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-depth-2">
							<div className="flex items-center gap-1.5 mb-1">
								<Radio className="h-3.5 w-3.5 text-accent" />
								<span className="text-xs text-text-tertiary">Rooms</span>
							</div>
							<span className="text-lg font-bold text-text-primary">
								{globalStats.totalRoomsCreated}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-depth-2">
							<div className="flex items-center gap-1.5 mb-1">
								<Clock className="h-3.5 w-3.5 text-accent" />
								<span className="text-xs text-text-tertiary">Hours Today</span>
							</div>
							<span className="text-lg font-bold text-text-primary">
								{globalStats.totalHoursStreamedToday}h
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-depth-2">
							<div className="flex items-center gap-1.5 mb-1">
								<TrendingUp className="h-3.5 w-3.5 text-accent" />
								<span className="text-xs text-text-tertiary">Peak Users</span>
							</div>
							<span className="text-lg font-bold text-text-primary">
								{globalStats.peakConcurrentUsers}
							</span>
						</div>
					</div>
				</div>
			)}

			{/* Card 2: Trending Rooms - Show if has data */}
			{trendingRooms.length > 0 && (
				<div className="bg-depth-1 rounded-xl border border-border-subtle p-5">
					<div className="flex items-center gap-2 mb-4">
						<Flame className="h-5 w-5 text-warning" />
						<h3 className="font-semibold text-text-primary">Trending Now</h3>
					</div>
					<div className="space-y-2">
						{trendingRooms.map((room) => (
							<div
								key={room.id}
								className="flex items-center gap-3 p-2.5 rounded-lg bg-depth-2 hover:bg-depth-3 transition-colors"
							>
								<div className="flex-1 min-w-0">
									<p className="font-medium text-text-primary truncate text-sm">
										{room.name}
									</p>
									<p className="text-xs text-text-tertiary">
										{room.streamerName ?? "No Streamer"}
									</p>
								</div>
								<div className="flex items-center gap-1 text-xs text-text-secondary">
									<span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
									<span>{room.viewerCount}</span>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Card 3: Community Stats - Show if has data */}
			{communityStats.totalRegisteredUsers > 0 && (
				<CommunityStatsCard stats={communityStats} />
			)}

			{/* Call to Action */}
			<div className="bg-accent/10 rounded-xl border border-accent/20 p-5">
				<h3 className="font-semibold text-text-primary mb-2">
					Join BhayanakCast
				</h3>
				<p className="text-sm text-text-secondary mb-4">
					Create your own rooms, track your watch time, and connect with other
					viewers.
				</p>
				<Link
					to="/auth/$authView"
					params={{ authView: "sign-up" }}
					className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-accent/20"
				>
					<span>Get Started</span>
				</Link>
			</div>
		</div>
	);
}
