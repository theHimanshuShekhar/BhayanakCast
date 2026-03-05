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
	const roomsToEnd = await db
		.select({
			id: streamingRooms.id,
			name: streamingRooms.name,
		})
		.from(streamingRooms)
		.where(
			and(
				eq(streamingRooms.status, "waiting"),
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
	try {
		const roomsToEnd = await findRoomsToEnd();

		if (roomsToEnd.length === 0) {
			return;
		}

		for (const room of roomsToEnd) {
			await endRoom(room.id);

			// Broadcast room ended event if broadcast function provided
			if (broadcastRoomEnded) {
				broadcastRoomEnded(room.id);
			}
		}
	} catch (error) {
		console.error("[Room Cleanup] Error during cleanup:", error);
	}
}
