import { createFileRoute } from "@tanstack/react-router";
import { RoomList } from "#/components/RoomList";
import { publicRoute } from "#/lib/auth-guard";

// Public route - accessible to all users including logged out
export const Route = createFileRoute("/")({
	component: App,
	beforeLoad: publicRoute,
});

function App() {
	return (
		<div className="h-full w-full bg-depth-0 px-4 py-8 overflow-auto">
			<div className="mx-auto max-w-7xl">
				<div className="mb-8">
					<h1 className="text-3xl font-bold text-text-primary mb-2">
						Active Rooms
					</h1>
					<p className="text-text-secondary">
						Join live streams or browse past broadcasts
					</p>
				</div>
				<RoomList />
			</div>
		</div>
	);
}
