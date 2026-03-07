import { and, eq, isNull } from "drizzle-orm";
import { db } from "#/db/index";
import { roomParticipants, streamingRooms } from "#/db/schema";

/**
 * Check who is currently in a room
 * Returns streamer presence and list of all participants
 */
export async function getRoomPresence(roomId: string) {
	// Get all active participants in the room
	const participants = await db
		.select({
			userId: roomParticipants.userId,
			joinedAt: roomParticipants.joinedAt,
		})
		.from(roomParticipants)
		.where(
			and(eq(roomParticipants.roomId, roomId), isNull(roomParticipants.leftAt)),
		);

	// Get room details to check who the streamer is
	const room = await db
		.select({
			streamerId: streamingRooms.streamerId,
			status: streamingRooms.status,
		})
		.from(streamingRooms)
		.where(eq(streamingRooms.id, roomId))
		.limit(1);

	if (room.length === 0) {
		return null;
	}

	const streamerId = room[0].streamerId;
	const streamerIsPresent = streamerId
		? participants.some((p) => p.userId === streamerId)
		: false;

	return {
		streamerId,
		streamerIsPresent,
		viewerCount: participants.length - (streamerIsPresent ? 1 : 0),
		totalParticipants: participants.length,
		participants,
		currentStatus: room[0].status,
	};
}

/**
 * Update room status based on who is present
 * - active: streamer is present
 * - preparing: streamer was assigned but left, viewers are waiting
 * - waiting: no streamer assigned, but viewers present (waiting for host)
 * - ended: should be handled by cleanup job after grace period
 */
export async function updateRoomStatusBasedOnPresence(roomId: string) {
	const presence = await getRoomPresence(roomId);

	if (!presence) {
		console.log(`[Presence] Room ${roomId} not found`);
		return;
	}

	const { streamerId, streamerIsPresent, totalParticipants, currentStatus } =
		presence;

	// Determine what the status should be
	let newStatus: string | null = null;

	if (streamerIsPresent) {
		// Streamer is in the room - room is active
		newStatus = "active";
	} else if (streamerId && totalParticipants > 0) {
		// Streamer assigned but not present, viewers are waiting
		newStatus = "preparing";
	} else if (!streamerId && totalParticipants > 0) {
		// No streamer assigned, but viewers present
		newStatus = "waiting";
	} else if (totalParticipants === 0 && currentStatus !== "ended") {
		// No one is present - room should be in waiting status until cleanup
		// This keeps the room visible but shows it's empty
		if (streamerId) {
			newStatus = "preparing";
		} else {
			newStatus = "waiting";
		}
	}

	// Only update if status needs to change
	if (newStatus && newStatus !== currentStatus) {
		console.log(
			`[Presence] Updating room ${roomId} status: ${currentStatus} → ${newStatus}`,
		);
		await db
			.update(streamingRooms)
			.set({ status: newStatus })
			.where(eq(streamingRooms.id, roomId));
		return newStatus;
	}

	return currentStatus;
}

/**
 * Run presence check and status update for all active rooms
 * Should be called periodically (e.g., every minute)
 */
export async function updateAllRoomStatuses() {
	console.log("[Presence] Starting room status updates...");

	// Get all non-ended rooms
	const rooms = await db
		.select({ id: streamingRooms.id })
		.from(streamingRooms)
		.where(eq(streamingRooms.status, "active"));

	console.log(`[Presence] Checking ${rooms.length} active rooms`);

	let updatedCount = 0;
	for (const room of rooms) {
		const newStatus = await updateRoomStatusBasedOnPresence(room.id);
		if (newStatus) {
			updatedCount++;
		}
	}

	console.log(`[Presence] Updated ${updatedCount} room statuses`);
}
