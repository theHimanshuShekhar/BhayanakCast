import { debounce } from "@tanstack/pacer";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "#/components/ui/input";
import { searchRooms } from "#/utils/home";
import { RoomCard } from "./RoomCard";

interface Room {
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
		};
		participantCount: number;
	}>;
}

export function RoomList({ initialRooms }: RoomListProps) {
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
		staleTime: 30 * 60 * 1000, // 30 minutes
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
			};
			participantCount: number;
		}>;
		if (!sourceData) return [];

		return sourceData.map((roomData) => ({
			id: roomData.room.id,
			name: roomData.room.name,
			description: roomData.room.description || "",
			streamerName: roomData.streamer.name,
			streamerImage: roomData.streamer.image || undefined,
			participantCount: roomData.participantCount || 0,
			maxUsersJoined: undefined,
			status: roomData.room.status as "active" | "ended",
			createdAt: new Date(roomData.room.createdAt),
		}));
	}, [searchedRooms, initialRooms]);

	const activeRooms = rooms.filter((room) => room.status === "active");
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
				<button
					type="button"
					className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-bg-primary font-bold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-accent/20 whitespace-nowrap xl:hidden"
					onClick={() => alert("Create room feature coming soon!")}
				>
					<Plus className="h-5 w-5" />
					<span>Create Room</span>
				</button>
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

			{/* Active rooms section */}
			{activeRooms.length > 0 && (
				<div>
					<h2 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
						<span className="relative flex h-2.5 w-2.5">
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
							<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
						</span>
						Live Now
						<span className="text-sm font-normal text-text-tertiary ml-2">
							({activeRooms.length})
						</span>
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{activeRooms.map((room) => (
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
