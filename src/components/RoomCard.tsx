import { Link } from "@tanstack/react-router";
import { History, Users } from "lucide-react";

function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

export interface Participant {
	id: string;
	name: string;
	image?: string;
}

export interface Room {
	id: string;
	name: string;
	description: string;
	streamerName?: string;
	streamerImage?: string;
	participantCount: number;
	maxUsersJoined?: number;
	status: "waiting" | "preparing" | "active" | "ended";
	createdAt: Date;
	endedAt?: Date;
	streamerIsPresent?: boolean;
	participants?: Participant[];
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

// Component to show participant avatars for ended rooms
function ParticipantAvatars({ participants }: { participants: Participant[] }) {
	const displayCount = Math.min(participants.length, 5);
	const remainingCount = participants.length - displayCount;

	return (
		<div className="flex items-center gap-1">
			<div className="flex -space-x-2">
				{participants.slice(0, displayCount).map((participant, index) => (
					<div
						key={participant.id}
						className="relative inline-block h-8 w-8 rounded-full border-2 border-depth-1"
						style={{ zIndex: displayCount - index }}
					>
						{participant.image ? (
							<img
								src={participant.image}
								alt={participant.name}
								className="h-full w-full rounded-full object-cover"
							/>
						) : (
							<div className="h-full w-full rounded-full bg-accent flex items-center justify-center">
								<span className="text-xs font-bold text-white">
									{participant.name.charAt(0).toUpperCase()}
								</span>
							</div>
						)}
					</div>
				))}
			</div>
			{remainingCount > 0 && (
				<span className="text-xs text-text-tertiary ml-1">
					+{remainingCount}
				</span>
			)}
		</div>
	);
}

export function RoomCard({ room }: RoomCardProps) {
	const isActive = room.status === "active" && !!room.streamerName;
	const isEnded = room.status === "ended";

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
			<div className="mb-4 pr-16 min-h-[3.5rem]">
				<h3 className="text-lg font-semibold text-text-primary truncate">
					{room.name}
				</h3>
				<p className="text-sm text-text-secondary mt-1 line-clamp-2">
					{room.description}
				</p>
			</div>

			{/* For ended rooms, show participant avatars */}
			{isEnded && room.participants && room.participants.length > 0 ? (
				<div className="flex items-center gap-3 mb-3">
					<ParticipantAvatars participants={room.participants} />
					<div className="flex-1 min-w-0">
						<p className="text-sm font-medium text-text-primary truncate">
							{room.participants.length} joined
						</p>
						<p className="text-xs text-text-tertiary">Stream participants</p>
					</div>
				</div>
			) : (
				/* For active/preparing/waiting rooms, show streamer info */
				<div className="flex items-center gap-3 mb-3">
					{room.streamerName ? (
						<>
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
								<p className="text-xs text-text-tertiary">
									{room.streamerIsPresent
										? "Streamer • Online"
										: "Streamer • Away"}
								</p>
							</div>
						</>
					) : (
						<>
							<div className="h-8 w-8 rounded-full bg-depth-3 flex items-center justify-center">
								<span className="text-sm font-bold text-text-secondary">?</span>
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-sm font-medium text-text-secondary truncate">
									No Streamer
								</p>
								<p className="text-xs text-text-tertiary">Waiting for host</p>
							</div>
						</>
					)}
				</div>
			)}

			{/* Stats */}
			<div className="flex items-center gap-4 pt-3 border-t border-border-subtle">
				<div className="flex items-center gap-1.5">
					<Users className="h-4 w-4 text-text-tertiary" />
					<span className="text-sm text-text-secondary">
						{isEnded
							? `${room.participantCount} joined`
							: isActive
								? room.participantCount
								: `Max: ${room.maxUsersJoined || room.participantCount}`}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					{room.status === "active" ? (
						<>
							<span className="h-2 w-2 rounded-full bg-green-500" />
							<span className="text-sm text-text-secondary">Streaming</span>
						</>
					) : room.status === "preparing" ? (
						<>
							<span className="h-2 w-2 rounded-full bg-yellow-500" />
							<span className="text-sm text-text-secondary">Preparing</span>
						</>
					) : room.status === "waiting" ? (
						<>
							<span className="h-2 w-2 rounded-full bg-gray-500" />
							<span className="text-sm text-text-secondary">Waiting</span>
						</>
					) : (
						<>
							<History className="h-4 w-4 text-text-tertiary" />
							<span className="text-sm text-text-secondary">
								Ended
								{room.endedAt &&
									` • ${(() => {
										const endedAt = room.endedAt;
										if (!endedAt) return "";
										const duration = Math.floor(
											(new Date(endedAt).getTime() -
												new Date(room.createdAt).getTime()) /
												1000,
										);
										return formatDuration(duration);
									})()}`}
							</span>
						</>
					)}
				</div>
			</div>
		</>
	);

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
