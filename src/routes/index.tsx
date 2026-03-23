import { createFileRoute } from "@tanstack/react-router";
import { ActiveRoomIndicator } from "#/components/ActiveRoomIndicator";
import { AnonymousStatsColumn } from "#/components/AnonymousStatsColumn";
import { RoomList, RoomListSkeleton } from "#/components/RoomList";
import { UserStatsCard } from "#/components/UserStatsCard";
import { getSessionOnServer, publicRoute } from "#/lib/auth-guard";
import { getHomeData } from "#/utils/home";

// Loading fallback component
function HomePageSkeleton() {
	return (
		<div className="h-full w-full bg-depth-0 px-4 py-8 overflow-auto">
			<div className="mx-auto max-w-7xl">
				<div className="flex gap-8">
					<div className="flex-1 min-w-0">
						<div className="mb-8">
							<div className="h-9 w-48 bg-depth-1 rounded animate-pulse mb-2" />
							<div className="h-5 w-72 bg-depth-1 rounded animate-pulse" />
						</div>
						<RoomListSkeleton />
					</div>
					<div className="hidden xl:block w-72 shrink-0">
						<div className="h-80 bg-depth-1 rounded-xl border border-border-subtle animate-pulse" />
					</div>
				</div>
			</div>
		</div>
	);
}

// Public route - accessible to all users including logged out
export const Route = createFileRoute("/")({
	component: App,
	beforeLoad: publicRoute,
	loader: async () => {
		const [homeData, session] = await Promise.all([
			getHomeData(),
			getSessionOnServer(),
		]);
		return { ...homeData, session };
	},
	pendingComponent: HomePageSkeleton,
	// Disable caching - always fetch fresh data from database
	staleTime: 0,
});

function App() {
	const homeData = Route.useLoaderData();
	const isLoggedIn = !!homeData.session?.user;

	return (
		<div className="h-full w-full bg-depth-0 px-4 py-8 overflow-auto">
			<div className="mx-auto max-w-7xl">
				<div className="flex gap-8">
					<div className="flex-1 min-w-0">
						<div className="mb-8">
							<h1 className="text-3xl font-bold text-text-primary mb-2">
								Active Rooms
							</h1>
							<p className="text-text-secondary">
								Join live streams or browse past broadcasts
							</p>
						</div>
						<RoomList
							initialRooms={homeData.activeRooms}
							userId={homeData.session?.user?.id}
						/>
					</div>
					{isLoggedIn ? (
						<UserStatsCard />
					) : (
						<AnonymousStatsColumn
							trendingRooms={homeData.trendingRooms}
							communityStats={homeData.communityStats}
							globalStats={homeData.globalStats}
						/>
					)}
				</div>
			</div>
			{homeData.session?.user?.id && (
				<ActiveRoomIndicator userId={homeData.session.user.id} />
			)}
		</div>
	);
}
