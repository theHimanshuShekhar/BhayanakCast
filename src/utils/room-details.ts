import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull } from "drizzle-orm";
import { roomParticipants, streamingRooms, users } from "#/db/schema";

/**
 * Get room details with participants
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

		// Get active participants
		const participants = await db
			.select({
				participant: roomParticipants,
				user: {
					id: users.id,
					name: users.name,
					image: users.image,
				},
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

		return {
			room: room[0],
			participants,
			participantCount: participants.length,
		};
	});
