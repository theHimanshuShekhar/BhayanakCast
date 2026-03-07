import { debounce } from "@tanstack/pacer";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CreateRoomModal } from "#/components/CreateRoomModal";
import { Input } from "#/components/ui/input";
import { searchRooms } from "#/utils/home";
import { RoomCard, RoomCardSkeleton } from "./RoomCard";

export function RoomListSkeleton() {
	return (
		<div className="space-y-6">
			{/* Search bar placeholder */}
			<div className="flex gap-3">
				<div className="flex-1 h-10 bg-depth-1 rounded-xl border border-border-subtle animate-pulse" />
			</div>

			{/* Results count placeholder */}
			<div className="h-5 w-32 bg-depth-1 rounded animate-pulse" />

			{/* Section title placeholder */}
			<div className="flex items-center gap-2 mb-4">
				<div className="h-2.5 w-2.5 bg-depth-1 rounded-full animate-pulse" />
				<div className="h-6 w-24 bg-depth-1 rounded animate-pulse" />
				<div className="h-5 w-12 bg-depth-1 rounded animate-pulse ml-2" />
			</div>

			{/* Grid of skeleton cards */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				<RoomCardSkeleton />
				<RoomCardSkeleton />
				<RoomCardSkeleton />
				<RoomCardSkeleton />
				<RoomCardSkeleton />
				<RoomCardSkeleton />
			</div>
		</div>
	);
}

interface Room {
	id: string;
	name: string;
	description: string;
	streamerName?: string;
	streamerImage?: string;
	participantCount: number;
	maxUsersJoined?: number;
	status: "waiting" | "preparing" | "active" | "ended";
	createdAt: Date;
}

interface RoomListProps {
	initialRooms: Array<{
		room: {
			id: string;
			name: string;
			description: string | null;
			status: string;
			createdAt: Date;
		};
		streamer: {
			id: string;
			name: string;
			image: string | null;
		} | null;
		participantCount: number;
	}>;
	userId?: string;
}

export function RoomList({ initialRooms, userId }: RoomListProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");

	// Create debounced setter
	const debouncedSetQuery = useMemo(
		() =>
			debounce(
				(value: string) => {
					setDebouncedQuery(value);
				},
				{ wait: 300 },
			),
		[],
	);

	const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setSearchQuery(value);
		debouncedSetQuery(value);
	};

	// Fetch rooms from server when searching
	const { data: searchedRooms } = useQuery({
		queryKey: ["rooms", "search", debouncedQuery],
		queryFn: async () => {
			if (!debouncedQuery.trim()) return null;
			return searchRooms({ data: { query: debouncedQuery } });
		},
		enabled: !!debouncedQuery.trim(),
		staleTime: 2 * 60 * 1000, // 2 minutes
	});

	// Transform database rooms to component format
	const rooms: Room[] = useMemo(() => {
		const sourceData = (searchedRooms || initialRooms) as Array<{
			room: {
				id: string;
				name: string;
				description: string | null;
				status: string;
				createdAt: Date;
			};
			streamer: {
				id: string;
				name: string;
				image: string | null;
			} | null;
			participantCount: number;
		}>;
		if (!sourceData) return [];

		return sourceData.map((roomData) => ({
			id: roomData.room.id,
			name: roomData.room.name,
			description: roomData.room.description || "",
			streamerName: roomData.streamer?.name,
			streamerImage: roomData.streamer?.image || undefined,
			participantCount: roomData.participantCount || 0,
			maxUsersJoined: undefined,
			status: roomData.room.status as "active" | "ended",
			createdAt: new Date(roomData.room.createdAt),
		}));
	}, [searchedRooms, initialRooms]);

	const liveRooms = rooms.filter((room) => room.status !== "ended");
	const endedRooms = rooms.filter((room) => room.status === "ended");

	return (
		<div className="space-y-6">
			{/* Search bar and Create Room */}
			<div className="flex gap-3">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
					<Input
						type="text"
						placeholder="Search rooms..."
						value={searchQuery}
						onChange={handleSearchChange}
						className="pl-10 bg-depth-1 border-border-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-accent"
					/>
				</div>
				{userId && (
					<CreateRoomModal userId={userId}>
						<button
							type="button"
							className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-accent/20 whitespace-nowrap xl:hidden"
						>
							<Plus className="h-5 w-5" />
							<span>Create Room</span>
						</button>
					</CreateRoomModal>
				)}
			</div>

			{/* Results count */}
			<div className="text-sm text-text-secondary">
				{rooms.length === 0
					? "No rooms found"
					: `Showing ${rooms.length} room${rooms.length === 1 ? "" : "s"}`}
				{debouncedQuery && (
					<span className="text-text-tertiary ml-1">
						for &quot;{debouncedQuery}&quot;
					</span>
				)}
			</div>

			{/* Live rooms section - includes active, preparing, and waiting */}
			{liveRooms.length > 0 && (
				<div>
					<h2 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
						<span className="relative flex h-2.5 w-2.5">
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
							<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
						</span>
						Live Now
						<span className="text-sm font-normal text-text-tertiary ml-2">
							({liveRooms.length})
						</span>
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{liveRooms.map((room) => (
							<RoomCard key={room.id} room={room} />
						))}
					</div>
				</div>
			)}

			{/* Ended rooms section */}
			{endedRooms.length > 0 && (
				<div>
					<h2 className="text-xl font-semibold text-text-primary mb-4">
						Past Streams
						<span className="text-sm font-normal text-text-tertiary ml-2">
							({endedRooms.length})
						</span>
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{endedRooms.map((room) => (
							<RoomCard key={room.id} room={room} />
						))}
					</div>
				</div>
			)}

			{/* Empty state */}
			{rooms.length === 0 && (
				<div className="text-center py-12">
					<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-depth-2 mb-4">
						<Search className="h-8 w-8 text-text-tertiary" />
					</div>
					<h3 className="text-lg font-medium text-text-primary mb-2">
						No rooms found
					</h3>
					<p className="text-text-secondary max-w-md mx-auto">
						Try adjusting your search terms or check back later for new streams.
					</p>
				</div>
			)}
		</div>
	);
}
