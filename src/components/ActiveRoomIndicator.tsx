import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { DoorOpen, Users } from "lucide-react";
import { leaveRoom } from "#/utils/rooms";

interface ActiveRoomIndicatorProps {
	userId: string;
}

export function ActiveRoomIndicator({ userId }: ActiveRoomIndicatorProps) {
	const navigate = useNavigate();

	// Query to get current room
	const { data: currentRoom, refetch } = useQuery({
		queryKey: ["currentRoom", userId],
		queryFn: async () => {
			const { getCurrentRoom } = await import("#/utils/rooms");
			return getCurrentRoom({ data: { userId } });
		},
		refetchInterval: 5000, // Refetch every 5 seconds
	});

	// Query to get participant count
	const { data: participants } = useQuery({
		queryKey: ["roomParticipants", currentRoom?.room.id],
		queryFn: async () => {
			if (!currentRoom) return null;
			const { getRoomParticipants } = await import("#/utils/rooms");
			return getRoomParticipants({ data: { roomId: currentRoom.room.id } });
		},
		refetchInterval: 5000, // Refetch every 5 seconds
		enabled: !!currentRoom,
	});

	// Don't show if not in a room
	if (!currentRoom) {
		return null;
	}

	const participantCount = participants?.length ?? 1; // Default to 1 (the user themselves)

	const handleLeave = async () => {
		await leaveRoom({
			data: {
				roomId: currentRoom.room.id,
				userId,
			},
		});
		refetch();
	};

	const handleViewRoom = () => {
		void navigate({
			to: "/room/$roomId",
			params: { roomId: currentRoom.room.id },
		});
	};

	return (
		<div className="fixed bottom-6 right-6 z-50 bg-depth-1 border border-border-subtle rounded-xl p-4 shadow-lg shadow-black/20 min-w-[280px]">
			<div className="flex items-start justify-between mb-3">
				<div className="flex-1 min-w-0 mr-3">
					<h3 className="font-semibold text-text-primary truncate">
						{currentRoom.room.name}
					</h3>
					<p className="text-xs text-text-tertiary">You are in this room</p>
				</div>
				<div className="flex items-center gap-1 text-text-secondary">
					<Users className="h-4 w-4" />
					<span className="text-sm">{participantCount}</span>
				</div>
			</div>

			<div className="flex gap-2">
				<button
					type="button"
					onClick={handleViewRoom}
					className="flex-1 px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-bg-primary text-sm font-medium transition-colors"
				>
					View Room
				</button>
				<button
					type="button"
					onClick={handleLeave}
					className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-depth-2 hover:bg-depth-3 text-text-secondary text-sm font-medium transition-colors"
				>
					<DoorOpen className="h-4 w-4" />
					<span>Leave</span>
				</button>
			</div>
		</div>
	);
}
