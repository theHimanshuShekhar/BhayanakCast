import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { getUserTopRelationships } from "#/utils/home";

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

function ConnectionsSkeleton() {
	return (
		<div className="space-y-3">
			{[1, 2, 3].map((i) => (
				<div key={i} className="flex items-center gap-3">
					<div className="h-6 w-6 rounded-full bg-depth-2 animate-pulse" />
					<div className="h-10 w-10 rounded-lg bg-depth-2 animate-pulse" />
					<div className="flex-1 space-y-2">
						<div className="h-4 w-24 bg-depth-2 rounded animate-pulse" />
						<div className="h-3 w-16 bg-depth-2 rounded animate-pulse" />
					</div>
				</div>
			))}
		</div>
	);
}

export function TopConnectionsCard() {
	const { data: session } = authClient.useSession();

	// Fetch top relationships using server function
	const { data: relationships, isLoading } = useQuery({
		queryKey: ["topConnections", session?.user?.id],
		queryFn: async () => {
			if (!session?.user?.id) return [];
			const result = await getUserTopRelationships({
				data: { userId: session.user.id, limit: 5 },
			});
			// Transform to match our interface
			return result.map((rel: (typeof result)[0]) => ({
				otherUserId: rel.otherUserId,
				totalTimeSeconds: rel.totalTimeSeconds,
				roomsCount: rel.roomsCount,
				user: rel.user
					? {
							id: rel.user.id,
							name: rel.user.name,
							image: rel.user.image,
						}
					: undefined,
			})) as Relationship[];
		},
		enabled: !!session?.user?.id,
		staleTime: 30 * 60 * 1000, // 30 minutes
	});

	// Don't render if user is not logged in or no connections
	if (!session?.user) {
		return null;
	}

	// Don't render the entire card if not loading and no connections
	if (!isLoading && (!relationships || relationships.length === 0)) {
		return null;
	}

	return (
		<div className="bg-depth-1 rounded-xl border border-border-subtle p-5">
			<div className="flex items-center gap-2 mb-4">
				<Users className="h-5 w-5 text-accent" />
				<h3 className="font-semibold text-text-primary">Top Connections</h3>
			</div>

			{isLoading ? (
				<ConnectionsSkeleton />
			) : relationships && relationships.length > 0 ? (
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
			) : null}
		</div>
	);
}
