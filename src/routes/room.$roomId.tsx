import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Clock, Crown, Users } from "lucide-react";

// Mock data for room details
interface Viewer {
	id: string;
	name: string;
	image?: string;
	role: "streamer" | "viewer";
	watchDurationSeconds: number;
	joinTime: Date;
	leaveTime: Date;
}

interface RoomDetails {
	id: string;
	name: string;
	description: string;
	streamer: {
		id: string;
		name: string;
		image?: string;
	};
	startedAt: Date;
	endedAt: Date;
	maxUsersJoined: number;
	viewers: Viewer[];
}

const mockRoomDetails: Record<string, RoomDetails> = {
	"7": {
		id: "7",
		name: "Cooking Show: Italian",
		description: "Making homemade pasta from scratch. Join me in the kitchen!",
		streamer: {
			id: "streamer-7",
			name: "Chef Maria",
			image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Maria",
		},
		startedAt: new Date(Date.now() - 1000 * 60 * 60 * 2.5),
		endedAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
		maxUsersJoined: 156,
		viewers: [
			{
				id: "v1",
				name: "Alice Chen",
				image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice",
				role: "viewer",
				watchDurationSeconds: 3600,
				joinTime: new Date(Date.now() - 1000 * 60 * 60 * 2.4),
				leaveTime: new Date(Date.now() - 1000 * 60 * 60 * 2),
			},
			{
				id: "v2",
				name: "Bob Smith",
				role: "viewer",
				watchDurationSeconds: 1800,
				joinTime: new Date(Date.now() - 1000 * 60 * 60 * 2.3),
				leaveTime: new Date(Date.now() - 1000 * 60 * 60 * 2),
			},
			{
				id: "v3",
				name: "Charlie Davis",
				image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Charlie",
				role: "viewer",
				watchDurationSeconds: 2700,
				joinTime: new Date(Date.now() - 1000 * 60 * 60 * 2.2),
				leaveTime: new Date(Date.now() - 1000 * 60 * 60 * 2),
			},
			{
				id: "v4",
				name: "Diana Wilson",
				role: "viewer",
				watchDurationSeconds: 900,
				joinTime: new Date(Date.now() - 1000 * 60 * 60 * 2.1),
				leaveTime: new Date(Date.now() - 1000 * 60 * 60 * 2),
			},
			{
				id: "v5",
				name: "Eve Johnson",
				image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Eve",
				role: "viewer",
				watchDurationSeconds: 3000,
				joinTime: new Date(Date.now() - 1000 * 60 * 60 * 2.5),
				leaveTime: new Date(Date.now() - 1000 * 60 * 60 * 2),
			},
		],
	},
};

function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export const Route = createFileRoute("/room/$roomId")({
	component: RoomDetailPage,
	loader: async ({ params }) => {
		const room = mockRoomDetails[params.roomId];
		if (!room) {
			throw notFound();
		}
		return room;
	},
});

function RoomDetailPage() {
	const room = Route.useLoaderData();
	const totalDuration =
		(room.endedAt.getTime() - room.startedAt.getTime()) / 1000;

	// Sort viewers by watch duration (longest first)
	const sortedViewers = [...room.viewers].sort(
		(a, b) => b.watchDurationSeconds - a.watchDurationSeconds,
	);

	return (
		<div className="h-full w-full bg-depth-0 px-4 py-8 overflow-auto">
			<div className="mx-auto max-w-4xl space-y-6">
				{/* Back button */}
				<Link
					to="/"
					className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
				>
					<ArrowLeft className="h-4 w-4" />
					<span>Back to rooms</span>
				</Link>

				{/* Room Header */}
				<div className="bg-depth-1 rounded-lg p-6 border border-border-subtle">
					<div className="flex items-start gap-4">
						<div className="flex-1">
							<div className="flex items-center gap-3 mb-2">
								<h1 className="text-2xl font-bold text-text-primary">
									{room.name}
								</h1>
								<span className="px-2 py-1 rounded text-xs font-medium bg-gray-500/20 text-gray-400">
									Ended
								</span>
							</div>
							<p className="text-text-secondary mb-4">{room.description}</p>

							<div className="flex flex-wrap gap-4 text-sm text-text-tertiary">
								<div className="flex items-center gap-1.5">
									<Clock className="h-4 w-4" />
									<span>Duration: {formatDuration(totalDuration)}</span>
								</div>
								<div className="flex items-center gap-1.5">
									<Users className="h-4 w-4" />
									<span>Max viewers: {room.maxUsersJoined}</span>
								</div>
								<div className="flex items-center gap-1.5">
									<span>
										{formatDate(room.startedAt)} - {formatDate(room.endedAt)}
									</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Streamer Section */}
				<div className="bg-depth-1 rounded-lg p-6 border border-border-subtle">
					<h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
						<Crown className="h-5 w-5 text-yellow-500" />
						Streamer
					</h2>
					<div className="flex items-center gap-4">
						{room.streamer.image ? (
							<img
								src={room.streamer.image}
								alt={room.streamer.name}
								className="h-16 w-16 rounded-full object-cover"
							/>
						) : (
							<div className="h-16 w-16 rounded-full bg-accent flex items-center justify-center">
								<span className="text-xl font-bold text-white">
									{room.streamer.name.charAt(0).toUpperCase()}
								</span>
							</div>
						)}
						<div>
							<h3 className="text-lg font-medium text-text-primary">
								{room.streamer.name}
							</h3>
							<p className="text-sm text-text-tertiary">Host</p>
						</div>
						<Link
							to="/profile/$userId"
							params={{ userId: room.streamer.id }}
							className="ml-auto px-4 py-2 bg-depth-2 hover:bg-depth-3 rounded-lg text-sm font-medium transition-colors"
						>
							View Profile
						</Link>
					</div>
				</div>

				{/* Viewers List */}
				<div className="bg-depth-1 rounded-lg p-6 border border-border-subtle">
					<h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
						<Users className="h-5 w-5 text-accent" />
						Viewers
						<span className="text-sm font-normal text-text-tertiary ml-2">
							({sortedViewers.length})
						</span>
					</h2>

					<div className="space-y-3">
						{sortedViewers.map((viewer, index) => (
							<div
								key={viewer.id}
								className="flex items-center gap-4 p-3 bg-depth-2 rounded-lg"
							>
								<div className="shrink-0 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
									<span className="text-sm font-bold text-accent">
										#{index + 1}
									</span>
								</div>

								{viewer.image ? (
									<img
										src={viewer.image}
										alt={viewer.name}
										className="h-12 w-12 rounded-full object-cover"
									/>
								) : (
									<div className="h-12 w-12 rounded-full bg-surface-3 flex items-center justify-center">
										<span className="text-lg font-medium text-text-primary">
											{viewer.name.charAt(0).toUpperCase()}
										</span>
									</div>
								)}

								<div className="flex-1 min-w-0">
									<h3 className="text-base font-medium text-text-primary truncate">
										{viewer.name}
									</h3>
									<p className="text-sm text-text-tertiary">
										{viewer.role === "streamer" ? "Co-streamer" : "Viewer"} •
										Joined {formatDate(viewer.joinTime)}
									</p>
								</div>

								<div className="text-right shrink-0">
									<p className="text-base font-semibold text-accent">
										{formatDuration(viewer.watchDurationSeconds)}
									</p>
									<p className="text-xs text-text-tertiary">watch time</p>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
