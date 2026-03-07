import { defineConfig } from "@tanstack/react-start/config";
import { runRoomCleanup } from "./src/utils/room-cleanup";

// Track if cleanup has been initialized
let cleanupInitialized = false;

export default defineConfig({
	server: {
		// Run before the server starts handling requests
		beforeStart: async () => {
			if (cleanupInitialized) {
				return;
			}
			
			console.log("[App] Initializing room cleanup job...");
			cleanupInitialized = true;
			
			// Run initial cleanup
			try {
				console.log("[Room Cleanup] Running initial cleanup on app startup...");
				await runRoomCleanup();
				console.log("[Room Cleanup] Initial cleanup completed");
			} catch (error) {
				console.error("[Room Cleanup] Error during initial cleanup:", error);
			}
			
			// Setup interval for subsequent runs
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
