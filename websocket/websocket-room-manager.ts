import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env files FIRST before any other imports
config({ path: join(__dirname, ".env.local"), override: true });
config({ path: join(__dirname, ".env"), override: true });

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../src/db/index";
import { roomParticipants, streamingRooms, users } from "../src/db/schema";
import { nanoid } from "nanoid";
import { RateLimits, rateLimiter } from "../src/lib/rate-limiter";

// In-memory tracking of socket -> room mapping for presence detection
const socketRoomMap = new Map<string, { roomId: string; userId: string }>();

/**
 * Get room details from database
 */
export async function getRoom(roomId: string) {
	const room = await db
		.select()
		.from(streamingRooms)
		.where(eq(streamingRooms.id, roomId))
		.limit(1);
	return room[0] || null;
}

/**
 * Get all active participants in a room
 */
export async function getRoomParticipants(roomId: string) {
	return await db
		.select({
			id: roomParticipants.id,
			userId: roomParticipants.userId,
			joinedAt: roomParticipants.joinedAt,
		})
		.from(roomParticipants)
		.where(
			and(
				eq(roomParticipants.roomId, roomId),
				isNull(roomParticipants.leftAt),
			),
		)
		.orderBy(roomParticipants.joinedAt);
}

/**
 * Add participant to room
 * Returns true if user became streamer (joined waiting room)
 */
export async function addParticipant(
	roomId: string,
	userId: string,
): Promise<{ participantId: string; becameStreamer: boolean; newStatus?: string }> {
	const participantId = nanoid();
	const now = new Date();

	// Check if user is already in room
	const existing = await db
		.select()
		.from(roomParticipants)
		.where(
			and(
				eq(roomParticipants.roomId, roomId),
				eq(roomParticipants.userId, userId),
				isNull(roomParticipants.leftAt),
			),
		)
		.limit(1);

	if (existing.length > 0) {
		return { participantId: existing[0].id, becameStreamer: false };
	}

	// Get current room status
	const room = await getRoom(roomId);
	if (!room) {
		throw new Error("Room not found");
	}

	// Check if room is joinable
	if (room.status === "ended") {
		throw new Error("Room has ended");
	}

	// Insert participant
	await db.insert(roomParticipants).values({
		id: participantId,
		roomId,
		userId,
		joinedAt: now,
		leftAt: null,
		totalTimeSeconds: 0,
	});

	// If joining a waiting room, become the streamer
	if (room.status === "waiting") {
		await db
			.update(streamingRooms)
			.set({
				streamerId: userId,
				status: "preparing",
			})
			.where(eq(streamingRooms.id, roomId));

		return { participantId, becameStreamer: true, newStatus: "preparing" };
	}

	// Check if room should become active (2+ participants)
	const participantCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(roomParticipants)
		.where(
			and(
				eq(roomParticipants.roomId, roomId),
				isNull(roomParticipants.leftAt),
			),
		);

	if (participantCount[0]?.count >= 2 && room.status === "preparing") {
		await db
			.update(streamingRooms)
			.set({ status: "active" })
			.where(eq(streamingRooms.id, roomId));

		return { participantId, becameStreamer: false, newStatus: "active" };
	}

	return { participantId, becameStreamer: false };
}

/**
 * Remove participant from room
 * Returns info about streamer transfer if applicable
 */
export async function removeParticipant(
	roomId: string,
	userId: string,
): Promise<{
	newStreamerId?: string;
	newStreamerName?: string;
	roomEmpty: boolean;
	newStatus?: string;
}> {
	const now = new Date();

	// Get participant record
	const participation = await db
		.select()
		.from(roomParticipants)
		.where(
			and(
				eq(roomParticipants.roomId, roomId),
				eq(roomParticipants.userId, userId),
				isNull(roomParticipants.leftAt),
			),
		)
		.limit(1);

	if (participation.length === 0) {
		return { roomEmpty: false };
	}

	// Calculate time spent
	const seconds = Math.floor(
		(now.getTime() - participation[0].joinedAt.getTime()) / 1000,
	);

	// Mark as left
	await db
		.update(roomParticipants)
		.set({ leftAt: now, totalTimeSeconds: seconds })
		.where(eq(roomParticipants.id, participation[0].id));

	// Check if streamer is leaving
	const room = await getRoom(roomId);
	if (!room || room.streamerId !== userId) {
		// Not the streamer, just check if room is now empty
		const remainingCount = await db
			.select({ count: sql<number>`count(*)` })
			.from(roomParticipants)
			.where(
				and(
					eq(roomParticipants.roomId, roomId),
					isNull(roomParticipants.leftAt),
				),
			);

		if (remainingCount[0]?.count === 0) {
			await db
				.update(streamingRooms)
				.set({ status: "waiting" })
				.where(eq(streamingRooms.id, roomId));
			return { roomEmpty: true, newStatus: "waiting" };
		}

		return { roomEmpty: false };
	}

	// Streamer is leaving - find next viewer
	const nextViewer = await db
		.select()
		.from(roomParticipants)
		.where(
			and(
				eq(roomParticipants.roomId, roomId),
				isNull(roomParticipants.leftAt),
				ne(roomParticipants.userId, userId),
			),
		)
		.orderBy(roomParticipants.joinedAt)
		.limit(1);

	if (nextViewer.length > 0) {
		// Transfer to next viewer
		await db
			.update(streamingRooms)
			.set({ streamerId: nextViewer[0].userId })
			.where(eq(streamingRooms.id, roomId));

		// Get new streamer's name
		const newStreamerUser = await db
			.select({ name: users.name })
			.from(users)
			.where(eq(users.id, nextViewer[0].userId))
			.limit(1);

		return {
			newStreamerId: nextViewer[0].userId,
			newStreamerName: newStreamerUser[0]?.name || "Someone",
			roomEmpty: false,
		};
	} else {
		// No viewers left - set to waiting
		await db
			.update(streamingRooms)
			.set({ streamerId: null, status: "waiting" })
			.where(eq(streamingRooms.id, roomId));

		return { roomEmpty: true, newStatus: "waiting" };
	}
}

/**
 * Update room status based on actual presence
 * Checks if streamer is still in room
 */
export async function updateRoomStatusFromPresence(roomId: string) {
	const room = await getRoom(roomId);
	if (!room || room.status === "ended") return null;

	const participants = await getRoomParticipants(roomId);
	const streamerId = room.streamerId;
	const streamerIsPresent = streamerId
		? participants.some((p) => p.userId === streamerId)
		: false;

	let newStatus: string | null = null;

	// Determine correct status based on presence
	if (streamerIsPresent && participants.length >= 2) {
		newStatus = "active";
	} else if (streamerIsPresent && participants.length === 1) {
		newStatus = "preparing";
	} else if (!streamerIsPresent && participants.length > 0 && streamerId) {
		// Streamer assigned but not present
		newStatus = "preparing";
	} else if (!streamerIsPresent && participants.length > 0 && !streamerId) {
		// No streamer, but viewers present
		newStatus = "waiting";
	} else if (participants.length === 0 && room.status !== "ended") {
		// Empty room
		newStatus = "waiting";
	}

	// Update if needed
	if (newStatus && newStatus !== room.status) {
		await db
			.update(streamingRooms)
			.set({ status: newStatus })
			.where(eq(streamingRooms.id, roomId));

		console.log(`[RoomManager] ${roomId}: ${room.status} → ${newStatus}`);
		return newStatus;
	}

	return room.status;
}

/**
 * Run status update for all non-ended rooms
 */
export async function updateAllRoomStatusesFromPresence() {
	console.log("[RoomManager] Updating all room statuses...");

	const rooms = await db
		.select({ id: streamingRooms.id })
		.from(streamingRooms)
		.where(sql`${streamingRooms.status} IN ('active', 'preparing', 'waiting')`);

	let updatedCount = 0;
	for (const room of rooms) {
		const newStatus = await updateRoomStatusFromPresence(room.id);
		if (newStatus) updatedCount++;
	}

	console.log(`[RoomManager] Updated ${updatedCount} rooms`);
	return updatedCount;
}

/**
 * Track socket joining room
 */
export function trackSocketJoin(socketId: string, roomId: string, userId: string) {
	socketRoomMap.set(socketId, { roomId, userId });
}

/**
 * Track socket leaving room
 */
export function trackSocketLeave(socketId: string) {
	socketRoomMap.delete(socketId);
}

/**
 * Get room info for a socket
 */
export function getSocketRoomInfo(socketId: string) {
	return socketRoomMap.get(socketId);
}

/**
 * End a room (set status to ended)
 */
export async function endRoom(roomId: string) {
	await db
		.update(streamingRooms)
		.set({ status: "ended", endedAt: new Date() })
		.where(eq(streamingRooms.id, roomId));
}

/**
 * Find rooms that should be ended (waiting and empty for 5+ minutes)
 */
export async function findRoomsToEnd() {
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

	return await db
		.select({
			id: streamingRooms.id,
			name: streamingRooms.name,
		})
		.from(streamingRooms)
		.where(
			and(
				eq(streamingRooms.status, "waiting"),
				// No active participants
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
				) < ${fiveMinutesAgo}`,
			),
		);
}

/**
 * Run cleanup job - end old waiting rooms
 */
export async function runRoomCleanupJob(
	broadcastRoomEnded?: (roomId: string) => void,
) {
	console.log("[RoomManager] Running cleanup job...");

	const roomsToEnd = await findRoomsToEnd();

	if (roomsToEnd.length === 0) {
		console.log("[RoomManager] No rooms to end");
		return;
	}

	console.log(`[RoomManager] Ending ${roomsToEnd.length} rooms`);

	for (const room of roomsToEnd) {
		console.log(`[RoomManager] Ending room: ${room.name} (${room.id})`);
		await endRoom(room.id);

		if (broadcastRoomEnded) {
			broadcastRoomEnded(room.id);
		}
	}
}

/**
 * Transfer streamer ownership to another user
 */
export async function transferStreamer(
	roomId: string,
	currentStreamerId: string,
	newStreamerId: string,
): Promise<{
	success: boolean;
	newStreamerId?: string;
	newStreamerName?: string;
	error?: string;
}> {
	// Check rate limit
	const transferLimiter = rateLimiter.forAction("streamer:transfer");
	const rateLimitResult = transferLimiter.checkAndRecord(
		roomId,
		RateLimits.STREAMER_TRANSFER,
	);
	if (!rateLimitResult.allowed) {
		return {
			success: false,
			error: `Transfer cooldown active. Try again in ${rateLimitResult.retryAfter} seconds.`,
		};
	}

	// Verify current user is streamer
	const room = await db
		.select()
		.from(streamingRooms)
		.where(
			and(
				eq(streamingRooms.id, roomId),
				sql`${streamingRooms.status} IN ('active', 'preparing')`,
			),
		)
		.limit(1);

	if (room.length === 0) {
		return { success: false, error: "Room not found" };
	}

	if (room[0].streamerId !== currentStreamerId) {
		return { success: false, error: "Only the streamer can transfer ownership" };
	}

	// Verify new streamer is in room
	const newStreamerParticipant = await db
		.select()
		.from(roomParticipants)
		.where(
			and(
				eq(roomParticipants.roomId, roomId),
				eq(roomParticipants.userId, newStreamerId),
				isNull(roomParticipants.leftAt),
			),
		)
		.limit(1);

	if (newStreamerParticipant.length === 0) {
		return { success: false, error: "New streamer is not in the room" };
	}

	// Transfer ownership
	await db
		.update(streamingRooms)
		.set({ streamerId: newStreamerId })
		.where(eq(streamingRooms.id, roomId));

	// Get new streamer's name
	const newStreamerUser = await db
		.select({ name: users.name })
		.from(users)
		.where(eq(users.id, newStreamerId))
		.limit(1);

	return {
		success: true,
		newStreamerId,
		newStreamerName: newStreamerUser[0]?.name || "Someone",
	};
}
