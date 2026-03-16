import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { roomParticipants, streamingRooms, users } from "#/db/schema";
import { RateLimits, rateLimiter } from "#/lib/rate-limiter";
import {
	broadcastRoomJoin,
	broadcastRoomLeave,
	broadcastStreamerChanged,
} from "#/utils/websocket-client";

const createRoomSchema = z.object({
	name: z.string().min(3).max(100),
	description: z.string().max(500).optional(),
});

export const getCurrentRoom = createServerFn({ method: "GET" })
	.inputValidator((data: { userId: string }) => data)
	.handler(async ({ data }) => {
		const { db } = await import("#/db/index");
		const participation = await db
			.select({ room: streamingRooms, participant: roomParticipants })
			.from(roomParticipants)
			.innerJoin(streamingRooms, eq(roomParticipants.roomId, streamingRooms.id))
			.where(
				and(
					eq(roomParticipants.userId, data.userId),
					isNull(roomParticipants.leftAt),
					eq(streamingRooms.status, "active"),
				),
			)
			.limit(1);
		return participation[0] || null;
	});

export const createRoom = createServerFn({ method: "POST" })
	.inputValidator(
		(data: { name: string; description?: string; userId: string }) => {
			createRoomSchema.parse({
				name: data.name,
				description: data.description,
			});
			return data;
		},
	)
	.handler(async ({ data }) => {
		const { db } = await import("#/db/index");
		const { nanoid } = await import("nanoid");

		// Check rate limit
		const roomCreateLimiter = rateLimiter.forAction("room:create");
		const rateLimitResult = roomCreateLimiter.checkAndRecord(
			data.userId,
			RateLimits.ROOM_CREATE,
		);
		if (!rateLimitResult.allowed) {
			throw new Error(
				`Rate limit exceeded. You can only create 3 rooms per minute. Try again in ${rateLimitResult.retryAfter} seconds.`,
			);
		}

		// Leave current room if any
		const currentRoom = await db
			.select()
			.from(roomParticipants)
			.where(
				and(
					eq(roomParticipants.userId, data.userId),
					isNull(roomParticipants.leftAt),
				),
			)
			.limit(1);

		if (currentRoom.length > 0) {
			const participation = currentRoom[0];
			const now = new Date();
			const seconds = Math.floor(
				(now.getTime() - participation.joinedAt.getTime()) / 1000,
			);
			await db
				.update(roomParticipants)
				.set({ leftAt: now, totalTimeSeconds: seconds })
				.where(eq(roomParticipants.id, participation.id));

			const room = await db
				.select()
				.from(streamingRooms)
				.where(eq(streamingRooms.id, participation.roomId))
				.limit(1);

			if (room.length > 0 && room[0].streamerId === data.userId) {
				const nextViewer = await db
					.select()
					.from(roomParticipants)
					.where(
						and(
							eq(roomParticipants.roomId, participation.roomId),
							isNull(roomParticipants.leftAt),
							ne(roomParticipants.userId, data.userId),
						),
					)
					.orderBy(asc(roomParticipants.joinedAt))
					.limit(1);

				if (nextViewer.length > 0) {
					await db
						.update(streamingRooms)
						.set({ streamerId: nextViewer[0].userId })
						.where(eq(streamingRooms.id, participation.roomId));
				} else {
					// No viewers left, set streamer to null and status to waiting
					await db
						.update(streamingRooms)
						.set({ streamerId: null, status: "waiting" })
						.where(eq(streamingRooms.id, participation.roomId));

					// Broadcast streamer change with null
					await broadcastStreamerChanged(participation.roomId, "");
				}
			}
		}

		const roomId = nanoid();
		const now = new Date();

		await db.insert(streamingRooms).values({
			id: roomId,
			name: data.name,
			description: data.description || null,
			streamerId: data.userId,
			status: "preparing",
			createdAt: now,
		});

		await db.insert(roomParticipants).values({
			id: nanoid(),
			roomId: roomId,
			userId: data.userId,
			joinedAt: now,
			leftAt: null,
			totalTimeSeconds: 0,
		});

		// Broadcast join event
		await broadcastRoomJoin(roomId, data.userId);

		const room = await db
			.select({
				room: streamingRooms,
				streamer: { id: users.id, name: users.name, image: users.image },
			})
			.from(streamingRooms)
			.innerJoin(users, eq(streamingRooms.streamerId, users.id))
			.where(eq(streamingRooms.id, roomId))
			.limit(1);

		return room[0];
	});

export const joinRoom = createServerFn({ method: "POST" })
	.inputValidator((data: { roomId: string; userId: string }) => data)
	.handler(async ({ data }) => {
		const { db } = await import("#/db/index");
		const { nanoid } = await import("nanoid");

		// Check rate limit
		const joinLimiter = rateLimiter.forAction("room:join");
		const rateLimitResult = joinLimiter.checkAndRecord(
			data.userId,
			RateLimits.ROOM_JOIN,
		);
		if (!rateLimitResult.allowed) {
			throw new Error(
				`Rate limit exceeded. You can only join 5 rooms per minute. Try again in ${rateLimitResult.retryAfter} seconds.`,
			);
		}

		// Allow joining active, preparing, or waiting rooms
		const room = await db
			.select()
			.from(streamingRooms)
			.where(
				and(
					eq(streamingRooms.id, data.roomId),
					sql`${streamingRooms.status} IN ('active', 'preparing', 'waiting')`,
				),
			)
			.limit(1);

		if (room.length === 0) throw new Error("Room not found or has ended");

		const existing = await db
			.select()
			.from(roomParticipants)
			.where(
				and(
					eq(roomParticipants.roomId, data.roomId),
					eq(roomParticipants.userId, data.userId),
					isNull(roomParticipants.leftAt),
				),
			)
			.limit(1);

		if (existing.length > 0) return { room: room[0], participant: existing[0] };

		const participantId = nanoid();
		const now = new Date();

		await db.insert(roomParticipants).values({
			id: participantId,
			roomId: data.roomId,
			userId: data.userId,
			joinedAt: now,
			leftAt: null,
			totalTimeSeconds: 0,
		});

		// If joining a waiting room, become the streamer
		if (room[0].status === "waiting") {
			await db
				.update(streamingRooms)
				.set({
					streamerId: data.userId,
					status: "preparing",
				})
				.where(eq(streamingRooms.id, data.roomId));

			// Broadcast streamer change
			await broadcastStreamerChanged(data.roomId, data.userId);
		} else {
			// Check if room should become active (2+ participants)
			const participantCount = await db
				.select({ count: sql<number>`count(*)` })
				.from(roomParticipants)
				.where(
					and(
						eq(roomParticipants.roomId, data.roomId),
						isNull(roomParticipants.leftAt),
					),
				);

			if (participantCount[0]?.count >= 2 && room[0].status === "preparing") {
				await db
					.update(streamingRooms)
					.set({ status: "active" })
					.where(eq(streamingRooms.id, data.roomId));
			}
		}

		// Broadcast join event
		await broadcastRoomJoin(data.roomId, data.userId);

		return {
			room: room[0],
			participant: {
				id: participantId,
				roomId: data.roomId,
				userId: data.userId,
				joinedAt: now,
			},
		};
	});

export const leaveRoom = createServerFn({ method: "POST" })
	.inputValidator((data: { roomId: string; userId: string }) => data)
	.handler(async ({ data }) => {
		const { db } = await import("#/db/index");

		// Check rate limit
		const leaveLimiter = rateLimiter.forAction("room:leave");
		const rateLimitResult = leaveLimiter.checkAndRecord(
			data.userId,
			RateLimits.ROOM_LEAVE,
		);
		if (!rateLimitResult.allowed) {
			throw new Error(
				`Rate limit exceeded. You're leaving rooms too quickly. Try again in ${rateLimitResult.retryAfter} seconds.`,
			);
		}

		const participation = await db
			.select()
			.from(roomParticipants)
			.where(
				and(
					eq(roomParticipants.roomId, data.roomId),
					eq(roomParticipants.userId, data.userId),
					isNull(roomParticipants.leftAt),
				),
			)
			.limit(1);

		if (participation.length === 0)
			return { success: false, error: "Not in room" };

		const now = new Date();
		const seconds = Math.floor(
			(now.getTime() - participation[0].joinedAt.getTime()) / 1000,
		);

		await db
			.update(roomParticipants)
			.set({ leftAt: now, totalTimeSeconds: seconds })
			.where(eq(roomParticipants.id, participation[0].id));

		const room = await db
			.select()
			.from(streamingRooms)
			.where(eq(streamingRooms.id, data.roomId))
			.limit(1);

		if (room.length > 0 && room[0].streamerId === data.userId) {
			const nextViewer = await db
				.select()
				.from(roomParticipants)
				.where(
					and(
						eq(roomParticipants.roomId, data.roomId),
						isNull(roomParticipants.leftAt),
						ne(roomParticipants.userId, data.userId),
					),
				)
				.orderBy(asc(roomParticipants.joinedAt))
				.limit(1);

			if (nextViewer.length > 0) {
				await db
					.update(streamingRooms)
					.set({ streamerId: nextViewer[0].userId })
					.where(eq(streamingRooms.id, data.roomId));

				// Broadcast streamer change
				await broadcastStreamerChanged(data.roomId, nextViewer[0].userId);
			} else {
				// No viewers left, set streamer to null and status to waiting
				await db
					.update(streamingRooms)
					.set({ streamerId: null, status: "waiting" })
					.where(eq(streamingRooms.id, data.roomId));

				// Broadcast streamer change with null
				await broadcastStreamerChanged(data.roomId, "");
			}
		}

		// Broadcast leave event
		await broadcastRoomLeave(data.roomId, data.userId);

		return { success: true };
	});

export const transferStreamerOwnership = createServerFn({ method: "POST" })
	.inputValidator(
		(data: {
			roomId: string;
			newStreamerId: string;
			currentStreamerId: string;
		}) => data,
	)
	.handler(async ({ data }) => {
		const { db } = await import("#/db/index");

		// Check rate limit
		const transferLimiter = rateLimiter.forAction("streamer:transfer");
		const rateLimitResult = transferLimiter.checkAndRecord(
			data.roomId,
			RateLimits.STREAMER_TRANSFER,
		);
		if (!rateLimitResult.allowed) {
			throw new Error(
				`Transfer cooldown active. Try again in ${rateLimitResult.retryAfter} seconds.`,
			);
		}

		// Verify current user is streamer
		const room = await db
			.select()
			.from(streamingRooms)
			.where(
				and(
					eq(streamingRooms.id, data.roomId),
					eq(streamingRooms.status, "active"),
				),
			)
			.limit(1);

		if (room.length === 0) throw new Error("Room not found");
		if (room[0].streamerId !== data.currentStreamerId) {
			throw new Error("Only the streamer can transfer ownership");
		}

		// Verify new streamer is in room
		const newStreamerParticipant = await db
			.select()
			.from(roomParticipants)
			.where(
				and(
					eq(roomParticipants.roomId, data.roomId),
					eq(roomParticipants.userId, data.newStreamerId),
					isNull(roomParticipants.leftAt),
				),
			)
			.limit(1);

		if (newStreamerParticipant.length === 0) {
			throw new Error("New streamer is not in the room");
		}

		// Transfer ownership
		await db
			.update(streamingRooms)
			.set({ streamerId: data.newStreamerId })
			.where(eq(streamingRooms.id, data.roomId));

		// Broadcast streamer change
		await broadcastStreamerChanged(data.roomId, data.newStreamerId);

		return { success: true, newStreamerId: data.newStreamerId };
	});

export const getRoomParticipants = createServerFn({ method: "GET" })
	.inputValidator((data: { roomId: string }) => data)
	.handler(async ({ data }) => {
		const { db } = await import("#/db/index");

		const participants = await db
			.select({
				participant: roomParticipants,
				user: { id: users.id, name: users.name, image: users.image },
			})
			.from(roomParticipants)
			.innerJoin(users, eq(roomParticipants.userId, users.id))
			.where(
				and(
					eq(roomParticipants.roomId, data.roomId),
					isNull(roomParticipants.leftAt),
				),
			)
			.orderBy(asc(roomParticipants.joinedAt));

		return participants;
	});
