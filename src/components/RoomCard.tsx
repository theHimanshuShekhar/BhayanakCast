import { Link } from "@tanstack/react-router";
import { History, Users } from "lucide-react";

export interface Room {
	id: string;
	name: string;
	description: string;
	streamerName: string;
	streamerImage?: string;
	participantCount: number;
	maxUsersJoined?: number;
	status: "active" | "ended";
	createdAt: Date;
}

interface RoomCardProps {
	room: Room;
}

export function RoomCardSkeleton() {
	return (
		<div className="group relative bg-depth-1 rounded-lg border border-border-subtle p-4">
			{/* Live indicator placeholder */}
			<div className="absolute top-3 right-3">
				<div className="h-2.5 w-12 bg-depth-3 rounded animate-pulse" />
			</div>

			{/* Room name and description */}
			<div className="mb-4 pr-16">
				<div className="h-6 w-3/4 bg-depth-3 rounded animate-pulse mb-2" />
				<div className="h-4 w-full bg-depth-3 rounded animate-pulse" />
			</div>

			{/* Streamer info */}
			<div className="flex items-center gap-3 mb-3">
				<div className="h-8 w-8 rounded-full bg-depth-3 animate-pulse" />
				<div className="flex-1">
					<div className="h-4 w-24 bg-depth-3 rounded animate-pulse mb-1" />
					<div className="h-3 w-16 bg-depth-3 rounded animate-pulse" />
				</div>
			</div>

			{/* Stats */}
			<div className="flex items-center gap-4 pt-3 border-t border-border-subtle">
				<div className="flex items-center gap-1.5">
					<div className="h-4 w-4 bg-depth-3 rounded animate-pulse" />
					<div className="h-4 w-12 bg-depth-3 rounded animate-pulse" />
				</div>
				<div className="flex items-center gap-1.5">
					<div className="h-2 w-2 bg-depth-3 rounded-full animate-pulse" />
					<div className="h-4 w-16 bg-depth-3 rounded animate-pulse" />
				</div>
			</div>
		</div>
	);
}

export function RoomCard({ room }: RoomCardProps) {
	const isActive = room.status === "active";

	const cardContent = (
		<>
			{/* Live indicator */}
			{isActive && (
				<div className="absolute top-3 right-3 flex items-center gap-1.5">
					<span className="relative flex h-2.5 w-2.5">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
						<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
					</span>
					<span className="text-xs font-medium text-red-400">LIVE</span>
				</div>
			)}

			{/* Room name and description */}
			<div className="mb-4 pr-16">
				<h3 className="text-lg font-semibold text-text-primary truncate">
					{room.name}
				</h3>
				<p className="text-sm text-text-secondary mt-1 line-clamp-2">
					{room.description}
				</p>
			</div>

			{/* Streamer info */}
			<div className="flex items-center gap-3 mb-3">
				{room.streamerImage ? (
					<img
						src={room.streamerImage}
						alt={room.streamerName}
						className="h-8 w-8 rounded-full object-cover"
					/>
				) : (
					<div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center">
						<span className="text-sm font-bold text-white">
							{room.streamerName.charAt(0).toUpperCase()}
						</span>
					</div>
				)}
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium text-text-primary truncate">
						{room.streamerName}
					</p>
					<p className="text-xs text-text-tertiary">Streamer</p>
				</div>
			</div>

			{/* Stats */}
			<div className="flex items-center gap-4 pt-3 border-t border-border-subtle">
				<div className="flex items-center gap-1.5">
					<Users className="h-4 w-4 text-text-tertiary" />
					<span className="text-sm text-text-secondary">
						{isActive
							? room.participantCount
							: `Max: ${room.maxUsersJoined || room.participantCount}`}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					{isActive ? (
						<>
							<span className="h-2 w-2 rounded-full bg-green-500" />
							<span className="text-sm text-text-secondary">Streaming</span>
						</>
					) : (
						<>
							<History className="h-4 w-4 text-text-tertiary" />
							<span className="text-sm text-text-secondary">Ended</span>
						</>
					)}
				</div>
			</div>
		</>
	);

	if (isActive) {
		return (
			<div className="group relative bg-depth-1 rounded-lg border border-border-subtle p-4 hover:bg-depth-2 hover:border-border-default transition-all">
				{cardContent}
			</div>
		);
	}

	return (
		<Link
			to="/room/$roomId"
			params={{ roomId: room.id }}
			className="group relative bg-depth-1 rounded-lg border border-border-subtle p-4 hover:bg-depth-2 hover:border-border-default transition-all block"
		>
			{cardContent}
		</Link>
	);
}
