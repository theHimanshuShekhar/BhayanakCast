import { Link } from "@tanstack/react-router";
import { Activity, Clock, Flame, Radio, TrendingUp, Users } from "lucide-react";

// Mock data for demonstration
const mockGlobalStats = {
	totalUsersOnline: 1247,
	totalRoomsCreated: 342,
	totalHoursStreamedToday: 186,
	peakConcurrentUsers: 89,
};

const mockTrendingRooms = [
	{
		id: "2",
		name: "Gaming Night - Elden Ring",
		streamerName: "Marcus Gaming",
		viewerCount: 128,
	},
	{
		id: "6",
		name: "Tech Talk: AI & Future",
		streamerName: "Tech Tom",
		viewerCount: 156,
	},
	{
		id: "5",
		name: "Digital Art Stream",
		streamerName: "ArtBySarah",
		viewerCount: 89,
	},
];

const mockCommunityStats = {
	totalRegisteredUsers: 15234,
	totalWatchHoursThisWeek: 8420,
	mostActiveStreamers: 142,
	newUsersThisWeek: 328,
};

export function AnonymousStatsColumn() {
	return (
		<div className="hidden xl:block w-72 shrink-0 space-y-4">
			{/* Card 1: Global Site Stats */}
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
							{mockGlobalStats.totalUsersOnline.toLocaleString()}
						</span>
					</div>
					<div className="p-2.5 rounded-lg bg-depth-2">
						<div className="flex items-center gap-1.5 mb-1">
							<Radio className="h-3.5 w-3.5 text-accent" />
							<span className="text-xs text-text-tertiary">Rooms</span>
						</div>
						<span className="text-lg font-bold text-text-primary">
							{mockGlobalStats.totalRoomsCreated}
						</span>
					</div>
					<div className="p-2.5 rounded-lg bg-depth-2">
						<div className="flex items-center gap-1.5 mb-1">
							<Clock className="h-3.5 w-3.5 text-accent" />
							<span className="text-xs text-text-tertiary">Hours Today</span>
						</div>
						<span className="text-lg font-bold text-text-primary">
							{mockGlobalStats.totalHoursStreamedToday}h
						</span>
					</div>
					<div className="p-2.5 rounded-lg bg-depth-2">
						<div className="flex items-center gap-1.5 mb-1">
							<TrendingUp className="h-3.5 w-3.5 text-accent" />
							<span className="text-xs text-text-tertiary">Peak Users</span>
						</div>
						<span className="text-lg font-bold text-text-primary">
							{mockGlobalStats.peakConcurrentUsers}
						</span>
					</div>
				</div>
			</div>

			{/* Card 2: Trending Rooms */}
			<div className="bg-depth-1 rounded-xl border border-border-subtle p-5">
				<div className="flex items-center gap-2 mb-4">
					<Flame className="h-5 w-5 text-warning" />
					<h3 className="font-semibold text-text-primary">Trending Now</h3>
				</div>
				<div className="space-y-2">
					{mockTrendingRooms.map((room) => (
						<div
							key={room.id}
							className="flex items-center gap-3 p-2.5 rounded-lg bg-depth-2 hover:bg-depth-3 transition-colors"
						>
							<div className="flex-1 min-w-0">
								<p className="font-medium text-text-primary truncate text-sm">
									{room.name}
								</p>
								<p className="text-xs text-text-tertiary">
									{room.streamerName}
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

			{/* Card 3: Community Stats */}
			<div className="bg-depth-1 rounded-xl border border-border-subtle p-5">
				<div className="flex items-center gap-2 mb-4">
					<Users className="h-5 w-5 text-accent" />
					<h3 className="font-semibold text-text-primary">Community</h3>
				</div>
				<div className="space-y-3">
					<div className="flex items-center justify-between p-2.5 rounded-lg bg-depth-2">
						<span className="text-sm text-text-secondary">Total Users</span>
						<span className="text-lg font-bold text-accent">
							{mockCommunityStats.totalRegisteredUsers.toLocaleString()}
						</span>
					</div>
					<div className="flex items-center justify-between p-2.5 rounded-lg bg-depth-2">
						<span className="text-sm text-text-secondary">
							Watch Hours (Week)
						</span>
						<span className="text-lg font-bold text-accent">
							{mockCommunityStats.totalWatchHoursThisWeek.toLocaleString()}h
						</span>
					</div>
					<div className="flex items-center justify-between p-2.5 rounded-lg bg-depth-2">
						<span className="text-sm text-text-secondary">
							Active Streamers
						</span>
						<span className="text-lg font-bold text-accent">
							{mockCommunityStats.mostActiveStreamers}
						</span>
					</div>
					<div className="flex items-center justify-between p-2.5 rounded-lg bg-depth-2">
						<span className="text-sm text-text-secondary">New This Week</span>
						<span className="text-lg font-bold text-success">
							+{mockCommunityStats.newUsersThisWeek}
						</span>
					</div>
				</div>
			</div>

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
