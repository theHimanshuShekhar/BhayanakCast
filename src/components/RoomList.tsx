import { debounce } from "@tanstack/pacer";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "#/components/ui/input";
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

// Mock data for rooms
const mockRooms: Room[] = [
	{
		id: "1",
		name: "Coding & Chill",
		description:
			"Building a full-stack app with React and Node.js. Come hang out and code together!",
		streamerName: "Alice Chen",
		participantCount: 42,
		status: "active",
		createdAt: new Date(Date.now() - 1000 * 60 * 30),
	},
	{
		id: "2",
		name: "Gaming Night - Elden Ring",
		description: "First playthrough, trying not to die too much. Tips welcome!",
		streamerName: "Marcus Gaming",
		streamerImage: "https://api.dicebear.com/7.x/avataaars/svg?seed=Marcus",
		participantCount: 128,
		status: "active",
		createdAt: new Date(Date.now() - 1000 * 60 * 120),
	},
	{
		id: "3",
		name: "Music Production Live",
		description:
			"Creating beats and answering questions about music production.",
		streamerName: "DJ Synth",
		participantCount: 67,
		status: "active",
		createdAt: new Date(Date.now() - 1000 * 60 * 45),
	},
	{
		id: "4",
		name: "Study With Me",
		description:
			"Pomodoro sessions, let's be productive together! 25 min work, 5 min break.",
		streamerName: "Study Buddy",
		streamerImage: "https://api.dicebear.com/7.x/avataaars/svg?seed=Study",
		participantCount: 23,
		status: "active",
		createdAt: new Date(Date.now() - 1000 * 60 * 15),
	},
	{
		id: "5",
		name: "Digital Art Stream",
		description:
			"Creating concept art for a new game project. Feedback appreciated!",
		streamerName: "ArtBySarah",
		participantCount: 89,
		status: "active",
		createdAt: new Date(Date.now() - 1000 * 60 * 60),
	},
	{
		id: "6",
		name: "Tech Talk: AI & Future",
		description:
			"Discussing the latest in AI technology and what it means for developers.",
		streamerName: "Tech Tom",
		streamerImage: "https://api.dicebear.com/7.x/avataaars/svg?seed=Tom",
		participantCount: 156,
		status: "active",
		createdAt: new Date(Date.now() - 1000 * 60 * 10),
	},
	{
		id: "7",
		name: "Cooking Show: Italian",
		description: "Making homemade pasta from scratch. Join me in the kitchen!",
		streamerName: "Chef Maria",
		participantCount: 34,
		maxUsersJoined: 156,
		status: "ended",
		createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
	},
	{
		id: "8",
		name: "React Learning Session",
		description:
			"Teaching React hooks and patterns to beginners. Ask anything!",
		streamerName: "Code Mentor",
		participantCount: 78,
		status: "active",
		createdAt: new Date(Date.now() - 1000 * 60 * 25),
	},
];

export function RoomList() {
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

	// Filter rooms based on debounced query
	const filteredRooms = useMemo(() => {
		if (!debouncedQuery.trim()) {
			return mockRooms;
		}
		const query = debouncedQuery.toLowerCase();
		return mockRooms.filter(
			(room) =>
				room.name.toLowerCase().includes(query) ||
				room.description.toLowerCase().includes(query) ||
				room.streamerName.toLowerCase().includes(query),
		);
	}, [debouncedQuery]);

	const activeRooms = filteredRooms.filter((room) => room.status === "active");
	const endedRooms = filteredRooms.filter((room) => room.status === "ended");

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
				{filteredRooms.length === 0
					? "No rooms found"
					: `Showing ${filteredRooms.length} room${filteredRooms.length === 1 ? "" : "s"}`}
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
			{filteredRooms.length === 0 && (
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
