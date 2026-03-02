import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { User } from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { getProfileData } from "#/utils/profile";

export const Route = createFileRoute("/profile/$userId")({
	component: ProfilePage,
	loader: async ({ params }) => {
		return await getProfileData({ data: { userId: params.userId } });
	},
});

function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

function ProfilePage() {
	const { userId } = Route.useParams();
	const { data: currentUser } = authClient.useSession();
	const { data: profile } = useSuspenseQuery({
		queryKey: ["profile", userId],
		queryFn: () => getProfileData({ data: { userId } }),
	});

	const isOwnProfile = currentUser?.user?.id === userId;

	if (!profile) {
		return (
			<div className="h-full w-full bg-depth-0 px-4 py-12">
				<div className="mx-auto max-w-4xl text-center">
					<User className="h-20 w-20 mx-auto text-text-tertiary mb-4" />
					<h1 className="text-4xl font-bold text-text-primary">
						User Not Found
					</h1>
					<p className="text-text-secondary mt-4">
						The user you're looking for doesn't exist.
					</p>
					<Link
						to="/"
						className="inline-block mt-6 text-accent hover:underline"
					>
						Go back home
					</Link>
				</div>
			</div>
		);
	}

	const { user, topRelationships } = profile;

	return (
		<div className="h-full w-full bg-depth-0 px-4 py-12 overflow-auto">
			<div className="mx-auto max-w-4xl space-y-8">
				<div className="bg-depth-1 rounded-lg p-6 border border-border-subtle">
					<div className="flex items-center gap-4">
						{user.image ? (
							<img
								src={user.image}
								alt={user.name}
								className="h-20 w-20 rounded-full object-cover"
							/>
						) : (
							<div className="h-20 w-20 rounded-full bg-accent flex items-center justify-center">
								<span className="text-2xl font-bold text-white">
									{user.name?.charAt(0).toUpperCase() || "U"}
								</span>
							</div>
						)}
						<div>
							<h1 className="text-3xl font-bold text-text-primary">
								{user.name}
								{isOwnProfile && (
									<span className="ml-3 text-sm font-normal text-accent bg-accent/10 px-2 py-1 rounded">
										You
									</span>
								)}
							</h1>
							<p className="text-text-secondary mt-1">{user.email}</p>
						</div>
					</div>
				</div>

				<div className="bg-depth-1 rounded-lg p-6 border border-border-subtle">
					<h2 className="text-2xl font-bold text-text-primary mb-6">
						{isOwnProfile ? "Your Top Connections" : "Top Connections"}
					</h2>
					{topRelationships.length === 0 ? (
						<p className="text-text-secondary">
							{isOwnProfile
								? "You haven't spent time with anyone yet. Join a room to start connecting!"
								: "This user hasn't spent time with anyone yet."}
						</p>
					) : (
						<div className="space-y-4">
							{topRelationships.map((rel, index) => (
								<Link
									key={rel.otherUserId}
									to="/profile/$userId"
									params={{ userId: rel.otherUserId }}
									className="flex items-center gap-4 p-4 bg-depth-2 rounded-lg hover:bg-depth-3 transition-colors"
								>
									<div className="shrink-0 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
										<span className="text-sm font-bold text-accent">
											#{index + 1}
										</span>
									</div>
									{rel.user?.image ? (
										<img
											src={rel.user.image}
											alt={rel.user.name}
											className="h-12 w-12 rounded-full object-cover"
										/>
									) : (
										<div className="h-12 w-12 rounded-full bg-surface-3 flex items-center justify-center">
											<span className="text-lg font-medium text-text-primary">
												{rel.user?.name?.charAt(0).toUpperCase() || "?"}
											</span>
										</div>
									)}
									<div className="flex-1 min-w-0">
										<h3 className="text-lg font-semibold text-text-primary truncate">
											{rel.user?.name || "Unknown User"}
										</h3>
										<p className="text-text-tertiary text-sm">
											{rel.roomsCount} {rel.roomsCount === 1 ? "room" : "rooms"}
										</p>
									</div>
									<div className="text-right">
										<p className="text-lg font-bold text-accent">
											{formatDuration(rel.totalTimeSeconds)}
										</p>
										<p className="text-text-tertiary text-sm">total time</p>
									</div>
								</Link>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
