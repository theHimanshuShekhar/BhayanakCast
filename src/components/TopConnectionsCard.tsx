import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "#/lib/auth-client";

interface Relationship {
	otherUserId: string;
	totalTimeSeconds: number;
	roomsCount: number;
	user?: {
		id: string;
		name: string;
		image: string | null;
	};
}

function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

// Mock data for demonstration
const mockRelationships: Relationship[] = [
	{
		otherUserId: "user-1",
		totalTimeSeconds: 32400,
		roomsCount: 5,
		user: {
			id: "user-1",
			name: "Alice Chen",
			image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice",
		},
	},
	{
		otherUserId: "user-2",
		totalTimeSeconds: 21600,
		roomsCount: 3,
		user: {
			id: "user-2",
			name: "Marcus Gaming",
			image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Marcus",
		},
	},
	{
		otherUserId: "user-3",
		totalTimeSeconds: 14400,
		roomsCount: 4,
		user: {
			id: "user-3",
			name: "DJ Synth",
			image: null,
		},
	},
	{
		otherUserId: "user-4",
		totalTimeSeconds: 7200,
		roomsCount: 2,
		user: {
			id: "user-4",
			name: "Study Buddy",
			image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Study",
		},
	},
	{
		otherUserId: "user-5",
		totalTimeSeconds: 3600,
		roomsCount: 1,
		user: {
			id: "user-5",
			name: "ArtBySarah",
			image: null,
		},
	},
];

export function TopConnectionsCard() {
	const { data: session } = authClient.useSession();
	const [relationships, setRelationships] = useState<Relationship[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		// Simulate fetching data
		const fetchData = async () => {
			setLoading(true);
			// In a real implementation, this would call a server function
			// For now, use mock data
			await new Promise((resolve) => setTimeout(resolve, 500));
			setRelationships(mockRelationships);
			setLoading(false);
		};

		if (session?.user) {
			fetchData();
		}
	}, [session?.user]);

	// Don't render if user is not logged in
	if (!session?.user) {
		return null;
	}

	return (
		<div className="bg-depth-1 rounded-xl border border-border-subtle p-5">
			<div className="flex items-center gap-2 mb-4">
				<Users className="h-5 w-5 text-accent" />
				<h3 className="font-semibold text-text-primary">Top Connections</h3>
			</div>

			{loading ? (
				<div className="space-y-3">
					{[...Array(3)].map((_, idx) => (
						// biome-ignore lint: Skeleton items are identical, index is acceptable here
						<div key={idx} className="flex items-center gap-3">
							<div className="h-10 w-10 rounded-lg bg-depth-2 animate-pulse" />
							<div className="flex-1 space-y-2">
								<div className="h-4 w-24 bg-depth-2 rounded animate-pulse" />
								<div className="h-3 w-16 bg-depth-2 rounded animate-pulse" />
							</div>
						</div>
					))}
				</div>
			) : relationships.length === 0 ? (
				<p className="text-sm text-text-tertiary text-center py-4">
					No connections yet. Join rooms to meet people!
				</p>
			) : (
				<div className="space-y-3">
					{relationships.map((rel, index) => (
						<Link
							key={rel.otherUserId}
							to="/profile/$userId"
							params={{ userId: rel.otherUserId }}
							className="flex items-center gap-3 p-2 rounded-lg hover:bg-depth-2 transition-colors group"
						>
							<div className="shrink-0 w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center">
								<span className="text-xs font-bold text-accent">
									#{index + 1}
								</span>
							</div>

							{rel.user?.image ? (
								<img
									src={rel.user.image}
									alt={rel.user.name}
									className="h-10 w-10 rounded-lg object-cover"
								/>
							) : (
								<div className="h-10 w-10 rounded-lg bg-surface-3 flex items-center justify-center">
									<span className="text-sm font-medium text-text-primary">
										{rel.user?.name?.charAt(0).toUpperCase() || "?"}
									</span>
								</div>
							)}

							<div className="flex-1 min-w-0">
								<p className="font-medium text-text-primary truncate group-hover:text-accent transition-colors">
									{rel.user?.name || "Unknown User"}
								</p>
								<p className="text-xs text-text-tertiary">
									{formatDuration(rel.totalTimeSeconds)} • {rel.roomsCount}{" "}
									{rel.roomsCount === 1 ? "room" : "rooms"}
								</p>
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
