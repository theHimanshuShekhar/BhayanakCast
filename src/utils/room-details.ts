import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { roomParticipants, streamingRooms, users } from "#/db/schema";
import type { RoomParticipant } from "#/hooks/useRoom";

/**
 * Get room details with participants
 * For ended rooms, returns all historical participants
 * For active/preparing/waiting rooms, returns only active participants
 *
 * Returns normalized participant structure matching WebSocket format:
 * { userId, userName, userImage, joinedAt, isMobile, totalTimeSeconds }
 */
export const getRoomDetails = createServerFn({ method: "GET" })
	.inputValidator((data: { roomId: string }) => data)
	.handler(async ({ data }) => {
		const { db } = await import("#/db/index");

		// Get room with streamer info
		const room = await db
			.select({
				room: streamingRooms,
				streamer: {
					id: users.id,
					name: users.name,
					image: users.image,
				},
			})
			.from(streamingRooms)
			.leftJoin(users, eq(streamingRooms.streamerId, users.id))
			.where(eq(streamingRooms.id, data.roomId))
			.limit(1);

		if (room.length === 0) {
			throw new Error("Room not found");
		}

		const isEnded = room[0].room.status === "ended";

		// Query participants and map to normalized structure
		let participants: RoomParticipant[];
		let participantCount: number;

		if (isEnded) {
			// For ended rooms, get ALL participants who joined (including those who left)
			const allParticipants = await db
				.select({
					id: roomParticipants.id,
					userId: roomParticipants.userId,
					joinedAt: roomParticipants.joinedAt,
					leftAt: roomParticipants.leftAt,
					totalTimeSeconds: roomParticipants.totalTimeSeconds,
					userName: users.name,
					userImage: users.image,
					isMobile: sql<boolean>`false`.as("is_mobile"), // Not tracked for historical
				})
				.from(roomParticipants)
				.innerJoin(users, eq(roomParticipants.userId, users.id))
				.where(eq(roomParticipants.roomId, data.roomId))
				.orderBy(desc(roomParticipants.joinedAt));

			// Deduplicate by user ID (keep the earliest participation)
			const seenUsers = new Set<string>();
			participants = allParticipants
				.filter((p) => {
					if (seenUsers.has(p.userId)) {
						return false;
					}
					seenUsers.add(p.userId);
					return true;
				})
				.map((p) => ({
					userId: p.userId,
					userName: p.userName || "Unknown",
					userImage: p.userImage ?? null,
					joinedAt: p.joinedAt,
					isMobile: p.isMobile,
					totalTimeSeconds: p.totalTimeSeconds || 0,
				}));

			participantCount = participants.length;
		} else {
			// For active rooms, get only currently active participants
			const activeParticipants = await db
				.select({
					userId: roomParticipants.userId,
					joinedAt: roomParticipants.joinedAt,
					userName: users.name,
					userImage: users.image,
					isMobile: sql<boolean>`false`.as("is_mobile"), // Will be updated via WebSocket
					totalTimeSeconds:
						sql<number>`EXTRACT(EPOCH FROM (NOW() - ${roomParticipants.joinedAt}))`.as(
							"total_time_seconds",
						),
				})
				.from(roomParticipants)
				.innerJoin(users, eq(roomParticipants.userId, users.id))
				.where(
					and(
						eq(roomParticipants.roomId, data.roomId),
						isNull(roomParticipants.leftAt),
					),
				)
				.orderBy(desc(roomParticipants.joinedAt));

			participants = activeParticipants.map((p) => ({
				userId: p.userId,
				userName: p.userName || "Unknown",
				userImage: p.userImage ?? null,
				joinedAt: p.joinedAt,
				isMobile: p.isMobile,
				totalTimeSeconds: Math.round(p.totalTimeSeconds || 0),
			}));

			participantCount = participants.length;
		}

		return {
			room: room[0],
			participants,
			participantCount,
			isEnded,
		};
	});
