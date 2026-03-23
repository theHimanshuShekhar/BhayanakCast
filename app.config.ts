import { defineConfig } from "@tanstack/react-start/config";

export default defineConfig({
	server: {
		// Run before the server starts handling requests
		beforeStart: async () => {
			console.log("[App] Initializing server...");

			// Initialize community stats
			try {
				console.log("[Community Stats] Calculating initial stats on app startup...");
				const { initializeCommunityStats, clearAllStatsSnapshots } = await import("./src/db/queries/community-stats");

				// Clear old stats to force fresh calculation
				await clearAllStatsSnapshots();
				console.log("[Community Stats] Cleared old stats snapshots");

				const stats = await initializeCommunityStats();
				console.log("[Community Stats] Initial stats calculated:", stats);
			} catch (error) {
				console.error("[Community Stats] Error calculating initial stats:", error);
			}

			// Note: Room cleanup is handled by the WebSocket server
			// See websocket/websocket-server.ts for the cleanup job
		},
	},
});
