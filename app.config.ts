import { defineConfig } from "@tanstack/react-start/config";
import { runRoomCleanup } from "./src/utils/room-cleanup";

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
			
			// Run initial room cleanup
			try {
				console.log("[Room Cleanup] Running initial cleanup on app startup...");
				await runRoomCleanup();
				console.log("[Room Cleanup] Initial cleanup completed");
			} catch (error) {
				console.error("[Room Cleanup] Error during initial cleanup:", error);
			}
			
			// Setup interval for subsequent room cleanup runs
			const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
			console.log(`[Room Cleanup] Scheduled to run every ${CLEANUP_INTERVAL / 1000} seconds`);
			
			setInterval(async () => {
				console.log("[Room Cleanup] Running scheduled cleanup...");
				try {
					await runRoomCleanup();
				} catch (error) {
					console.error("[Room Cleanup] Error during scheduled cleanup:", error);
				}
			}, CLEANUP_INTERVAL);
		},
	},
});
