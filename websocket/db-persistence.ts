/**
 * Database Persistence Layer
 *
 * Synchronous database operations for WebSocket-first architecture.
 * All operations wait for DB confirmation before returning.
 *
 * @module websocket/db-persistence
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { roomParticipants, streamingRooms, users } from "../src/db/schema";

// Types
export interface CreateRoomData {
	name: string;
	description?: string;
	userId: string;
}

export interface CreateRoomResult {
	roomId: string;
	name: string;
	description?: string;
	status: "waiting" | "preparing" | "active" | "ended";
	createdAt: Date;
}

export interface JoinRoomData {
	roomId: string;
	userId: string;
}

export interface JoinRoomResult {
	success: boolean;
	isStreamer: boolean;
	becameStreamer: boolean;
	participantId: string;
	joinedAt: Date;
}

export interface LeaveRoomData {
	roomId: string;
	userId: string;
	/** List of user IDs eligible to become streamers (non-mobile users) */
	eligibleStreamerIds?: string[];
}

export interface LeaveRoomResult {
	success: boolean;
	newStreamerId?: string;
	roomStatus?: "waiting" | "preparing" | "active" | "ended";
}

export interface ParticipantInfo {
	id: string;
	userId: string;
	userName: string;
	userImage?: string | null;
	joinedAt: Date;
	isStreamer: boolean;
}

/**
 * Generate a unique ID
 */
async function generateId(): Promise<string> {
	const { nanoid } = await import("nanoid");
	return nanoid();
}

/**
 * Create a new room and add creator as participant
 * Uses transaction for consistency
 */
export async function persistRoomCreation(
	data: CreateRoomData,
): Promise<CreateRoomResult> {
	const { db } = await import("../src/db/index");
	const now = new Date();
	const roomId = await generateId();

	await db.transaction(async (trx) => {
		// 1. Create room with creator as streamer
		await trx.insert(streamingRooms).values({
			id: roomId,
			name: data.name,
			description: data.description,
			status: "preparing",
			streamerId: data.userId,
			createdAt: now,
		});

		// 2. Add creator as participant
		const participantId = await generateId();
		await trx.insert(roomParticipants).values({
			id: participantId,
			roomId: roomId,
			userId: data.userId,
			joinedAt: now,
		});
	});

	return {
		roomId,
		name: data.name,
		description: data.description,
		status: "preparing" as const,
		createdAt: now,
	};
}

/**
 * Join a room - add participant and update room status if needed
 */
export async function persistParticipantJoin(
	data: JoinRoomData,
): Promise<JoinRoomResult> {
	const { db } = await import("../src/db/index");
	const now = new Date();
	const participantId = await generateId();

	return await db.transaction(async (trx) => {
		// 1. Get current room state
		const room = await trx
			.select()
			.from(streamingRooms)
			.where(eq(streamingRooms.id, data.roomId))
			.for("update") // Lock the row
			.then((rows) => rows[0]);

		if (!room) {
			throw new Error("Room not found");
		}

		if (room.status === "ended") {
			throw new Error("Room has ended");
		}

		// 2. Check if user is already in room
		const existingParticipant = await trx
			.select()
			.from(roomParticipants)
			.where(
				and(
					eq(roomParticipants.roomId, data.roomId),
					eq(roomParticipants.userId, data.userId),
					sql`${roomParticipants.leftAt} IS NULL`,
				),
			)
			.then((rows) => rows[0]);

		if (existingParticipant) {
			// User was previously in room but may have disconnected abruptly
			// Mark them as having left and allow rejoin
			console.log(
				`[DB] User ${data.userId} was already in room ${data.roomId}, marking as left and allowing rejoin`,
			);
			const timeInRoom = Math.floor(
				(now.getTime() - existingParticipant.joinedAt.getTime()) / 1000,
			);
			await trx
				.update(roomParticipants)
				.set({
					leftAt: now,
					totalTimeSeconds: timeInRoom,
				})
				.where(eq(roomParticipants.id, existingParticipant.id));
		}

		// 3. Count current participants
		const participantCount = await trx
			.select({ count: sql<number>`count(*)` })
			.from(roomParticipants)
			.where(
				and(
					eq(roomParticipants.roomId, data.roomId),
					sql`${roomParticipants.leftAt} IS NULL`,
				),
			)
			.then((rows) => rows[0]?.count || 0);

		// 4. Determine if user becomes streamer
		const isFirstParticipant = participantCount === 0;
		const becameStreamer = isFirstParticipant && room.status === "waiting";

		// 5. Add participant
		await trx.insert(roomParticipants).values({
			id: participantId,
			roomId: data.roomId,
			userId: data.userId,
			joinedAt: now,
		});

		// 6. Update room if needed
		if (becameStreamer) {
			await trx
				.update(streamingRooms)
				.set({
					streamerId: data.userId,
					status: "preparing",
				})
				.where(eq(streamingRooms.id, data.roomId));
		} else if (room.status === "preparing" && participantCount + 1 >= 2) {
			// Room becomes active with 2+ participants
			await trx
				.update(streamingRooms)
				.set({
					status: "active",
				})
				.where(eq(streamingRooms.id, data.roomId));
		}

		return {
			success: true,
			isStreamer: becameStreamer,
			becameStreamer,
			participantId,
			joinedAt: now,
		};
	});
}

/**
 * Leave a room - mark participant as left and handle streamer transfer
 */
export async function persistParticipantLeave(
	data: LeaveRoomData,
): Promise<LeaveRoomResult> {
	const { db } = await import("../src/db/index");
	const now = new Date();

	return await db.transaction(async (trx) => {
		// 1. Get participant record
		const participant = await trx
			.select()
			.from(roomParticipants)
			.where(
				and(
					eq(roomParticipants.roomId, data.roomId),
					eq(roomParticipants.userId, data.userId),
					sql`${roomParticipants.leftAt} IS NULL`,
				),
			)
			.then((rows) => rows[0]);

		if (!participant) {
			throw new Error("Not in room");
		}

		// 2. Calculate watch time
		const watchTimeSeconds = Math.floor(
			(now.getTime() - participant.joinedAt.getTime()) / 1000,
		);

		// 3. Mark as left
		await trx
			.update(roomParticipants)
			.set({
				leftAt: now,
				totalTimeSeconds: watchTimeSeconds,
			})
			.where(eq(roomParticipants.id, participant.id));

		// 4. Get room state
		const room = await trx
			.select()
			.from(streamingRooms)
			.where(eq(streamingRooms.id, data.roomId))
			.then((rows) => rows[0]);

		if (!room) {
			throw new Error("Room not found");
		}

		// 5. Handle streamer transfer if needed
		let newStreamerId: string | undefined;

		if (room.streamerId === data.userId) {
			// Find next viewer (earliest joined) who is eligible to stream
			// Filter by eligibleStreamerIds if provided (to exclude mobile users)
			const eligibleIds = data.eligibleStreamerIds;
			
			const nextViewer = await trx
				.select()
				.from(roomParticipants)
				.where(
					and(
						eq(roomParticipants.roomId, data.roomId),
						sql`${roomParticipants.leftAt} IS NULL`,
						// Filter by eligible IDs if provided (safe parameterized query)
						eligibleIds && eligibleIds.length > 0
							? inArray(roomParticipants.userId, eligibleIds)
							: sql`1=1`,
					),
				)
				.orderBy(sql`${roomParticipants.joinedAt} ASC`)
				.limit(1)
				.then((rows) => rows[0]);

			if (nextViewer) {
				newStreamerId = nextViewer.userId;
				await trx
					.update(streamingRooms)
					.set({
						streamerId: newStreamerId,
					})
					.where(eq(streamingRooms.id, data.roomId));
			} else {
				// No eligible viewers left (all mobile or no viewers), clear streamer
				await trx
					.update(streamingRooms)
					.set({
						streamerId: null,
						status: "waiting",
					})
					.where(eq(streamingRooms.id, data.roomId));
			}
		}

		// 6. Count remaining participants
		const remainingCount = await trx
			.select({ count: sql<number>`count(*)` })
			.from(roomParticipants)
			.where(
				and(
					eq(roomParticipants.roomId, data.roomId),
					sql`${roomParticipants.leftAt} IS NULL`,
				),
			)
			.then((rows) => rows[0]?.count || 0);

		// 7. Update status if needed
		let roomStatus = room.status;
		if (remainingCount === 0 && room.status !== "waiting") {
			await trx
				.update(streamingRooms)
				.set({
					status: "waiting",
				})
				.where(eq(streamingRooms.id, data.roomId));
			roomStatus = "waiting";
		}

		return {
			success: true,
			newStreamerId,
			roomStatus: roomStatus as "waiting" | "preparing" | "active" | "ended",
		};
	});
}

/**
 * Transfer streamer ownership
 */
export async function persistStreamerTransfer(
	roomId: string,
	newStreamerId: string,
): Promise<boolean> {
	const { db } = await import("../src/db/index");

	return await db.transaction(async (trx) => {
		// 1. Verify new streamer is in room
		const isInRoom = await trx
			.select({ count: sql<number>`count(*)` })
			.from(roomParticipants)
			.where(
				and(
					eq(roomParticipants.roomId, roomId),
					eq(roomParticipants.userId, newStreamerId),
					sql`${roomParticipants.leftAt} IS NULL`,
				),
			)
			.then((rows) => (rows[0]?.count || 0) > 0);

		if (!isInRoom) {
			throw new Error("New streamer is not in room");
		}

		// 2. Update streamer
		await trx
			.update(streamingRooms)
			.set({
				streamerId: newStreamerId,
			})
			.where(eq(streamingRooms.id, roomId));

		return true;
	});
}

/**
 * End a room (cleanup job)
 * Also marks all active participants as having left
 */
export async function persistRoomEnd(
	roomId: string,
): Promise<boolean> {
	const { db } = await import("../src/db/index");
	const now = new Date();

	await db.transaction(async (trx) => {
		// 1. Mark all active participants as having left
		await trx
			.update(roomParticipants)
			.set({
				leftAt: now,
				totalTimeSeconds: sql`EXTRACT(EPOCH FROM (${now} - ${roomParticipants.joinedAt}))`,
			})
			.where(
				and(
					eq(roomParticipants.roomId, roomId),
					sql`${roomParticipants.leftAt} IS NULL`,
				),
			);

		// 2. Update room status to ended
		await trx
			.update(streamingRooms)
			.set({
				status: "ended",
				endedAt: now,
			})
			.where(eq(streamingRooms.id, roomId));
	});

	return true;
}

/**
 * Get room from database (for rejoin/rebuild)
 */
export async function getRoomFromDB(
	roomId: string,
): Promise<{
	id: string;
	name: string;
	description: string | null;
	status: string;
	streamerId: string | null;
	createdAt: Date;
} | null> {
	const { db } = await import("../src/db/index");

	const room = await db
		.select()
		.from(streamingRooms)
		.where(eq(streamingRooms.id, roomId))
		.then((rows) => rows[0]);

	return room || null;
}

/**
 * Get active participants from database (for rejoin/rebuild)
 */
export async function getActiveParticipantsFromDB(
	roomId: string,
): Promise<
	Array<{
		userId: string;
		userName: string;
		userImage: string | null;
		joinedAt: Date;
	}>
> {
	const { db } = await import("../src/db/index");

	const participants = await db
		.select({
			userId: roomParticipants.userId,
			userName: users.name,
			userImage: users.image,
			joinedAt: roomParticipants.joinedAt,
		})
		.from(roomParticipants)
		.innerJoin(users, eq(roomParticipants.userId, users.id))
		.where(
			and(
				eq(roomParticipants.roomId, roomId),
				sql`${roomParticipants.leftAt} IS NULL`,
			),
		);

	return participants;
}

/**
 * Find stale rooms from database (waiting status, no participants for 5+ minutes)
 */
export async function findStaleRoomsFromDB(
	maxAgeMinutes: number = 5,
): Promise<Array<{ id: string; name: string }>> {
	const { db } = await import("../src/db/index");
	const now = new Date();
	const cutoff = new Date(now.getTime() - maxAgeMinutes * 60 * 1000);

	const staleRooms = await db
		.select({
			id: streamingRooms.id,
			name: streamingRooms.name,
		})
		.from(streamingRooms)
		.where(
			and(
				eq(streamingRooms.status, "waiting"),
				// Room must be at least 5 minutes old
				sql`${streamingRooms.createdAt} < ${cutoff}`,
				// No active participants
				sql`NOT EXISTS (
					SELECT 1 FROM ${roomParticipants}
					WHERE ${roomParticipants.roomId} = ${streamingRooms.id}
					AND ${roomParticipants.leftAt} IS NULL
				)`,
				// No participants have joined recently (last activity > 5 min ago)
				sql`(
					SELECT MAX(${roomParticipants.joinedAt})
					FROM ${roomParticipants}
					WHERE ${roomParticipants.roomId} = ${streamingRooms.id}
				) < ${cutoff} OR NOT EXISTS (
					SELECT 1 FROM ${roomParticipants}
					WHERE ${roomParticipants.roomId} = ${streamingRooms.id}
				)
			`,
			),
		);

	return staleRooms;
}

/**
 * Check if user is in any active room
 */
export async function getUserActiveRoom(
	userId: string,
): Promise<string | null> {
	const { db } = await import("../src/db/index");

	const participant = await db
		.select({ roomId: roomParticipants.roomId })
		.from(roomParticipants)
		.innerJoin(
			streamingRooms,
			eq(roomParticipants.roomId, streamingRooms.id),
		)
		.where(
			and(
				eq(roomParticipants.userId, userId),
				sql`${roomParticipants.leftAt} IS NULL`,
				sql`${streamingRooms.status} IN ('waiting', 'preparing', 'active')`,
			),
		)
		.limit(1)
		.then((rows) => rows[0]);

	return participant?.roomId || null;
}

/**
 * Leave all rooms (for single-room enforcement)
 */
export async function leaveAllRooms(userId: string): Promise<string[]> {
	const { db } = await import("../src/db/index");
	const now = new Date();

	// Get all active participations
	const participations = await db
		.select()
		.from(roomParticipants)
		.where(
			and(
				eq(roomParticipants.userId, userId),
				sql`${roomParticipants.leftAt} IS NULL`,
			),
		);

	const leftRoomIds: string[] = [];

	for (const participation of participations) {
		const watchTimeSeconds = Math.floor(
			(now.getTime() - participation.joinedAt.getTime()) / 1000,
		);

		await db
			.update(roomParticipants)
			.set({
				leftAt: now,
				totalTimeSeconds: watchTimeSeconds,
			})
			.where(eq(roomParticipants.id, participation.id));

		leftRoomIds.push(participation.roomId);
	}

	return leftRoomIds;
}
