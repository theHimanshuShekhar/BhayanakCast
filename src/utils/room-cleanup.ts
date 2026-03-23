import { and, eq, sql } from "drizzle-orm";
import { roomParticipants, streamingRooms } from "#/db/schema";

const GRACE_PERIOD_MINUTES = 5;

/**
 * Find rooms that should be ended (empty for 5+ minutes)
 */
export async function findRoomsToEnd() {
	const { db } = await import("#/db/index");

	const now = new Date();
	const gracePeriodAgo = new Date(
		now.getTime() - GRACE_PERIOD_MINUTES * 60 * 1000,
	);

	// Find waiting rooms (no streamer) with no active participants
	// where the last participant left more than 5 minutes ago
	// AND room was created more than 5 minutes ago (safety check)
	const roomsToEnd = await db
		.select({
			id: streamingRooms.id,
			name: streamingRooms.name,
		})
		.from(streamingRooms)
		.where(
			and(
				eq(streamingRooms.status, "waiting"),
				// Room must be at least 5 minutes old (prevent ending newly created rooms)
				sql`${streamingRooms.createdAt} < ${gracePeriodAgo}`,
				// No active participants in this room
				sql`NOT EXISTS (
					SELECT 1 FROM ${roomParticipants}
					WHERE ${roomParticipants.roomId} = ${streamingRooms.id}
					AND ${roomParticipants.leftAt} IS NULL
				)`,
				// Last participant left more than 5 minutes ago
				sql`(
					SELECT MAX(${roomParticipants.leftAt})
					FROM ${roomParticipants}
					WHERE ${roomParticipants.roomId} = ${streamingRooms.id}
				) < ${gracePeriodAgo}`,
			),
		);

	return roomsToEnd;
}

/**
 * End a room by updating its status
 */
export async function endRoom(roomId: string) {
	const { db } = await import("#/db/index");

	await db
		.update(streamingRooms)
		.set({
			status: "ended",
			endedAt: new Date(),
		})
		.where(eq(streamingRooms.id, roomId));
}

/**
 * Run the room cleanup job
 * Called every 5 minutes
 */
export async function runRoomCleanup(
	broadcastRoomEnded?: (roomId: string) => void,
) {
	console.log("[Room Cleanup] Starting cleanup job...");
	try {
		const roomsToEnd = await findRoomsToEnd();

		if (roomsToEnd.length === 0) {
			console.log("[Room Cleanup] No rooms to end");
			return;
		}

		console.log(`[Room Cleanup] Found ${roomsToEnd.length} rooms to end`);

		for (const room of roomsToEnd) {
			console.log(`[Room Cleanup] Ending room: ${room.name} (${room.id})`);
			await endRoom(room.id);

			// Broadcast room ended event if broadcast function provided
			if (broadcastRoomEnded) {
				broadcastRoomEnded(room.id);
			}
		}

		console.log("[Room Cleanup] Cleanup completed successfully");
	} catch (error) {
		console.error("[Room Cleanup] Error during cleanup:", error);
	}
}
