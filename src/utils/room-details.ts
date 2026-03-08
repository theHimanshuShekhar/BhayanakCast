import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull } from "drizzle-orm";
import { roomParticipants, streamingRooms, users } from "#/db/schema";

/**
 * Get room details with participants
 * For ended rooms, returns all historical participants
 * For active/preparing/waiting rooms, returns only active participants
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

		let participants: Array<{
			participant: typeof roomParticipants.$inferSelect;
			user: {
				id: string;
				name: string;
				image: string | null;
			};
		}>;
		let participantCount: number;

		if (isEnded) {
			// For ended rooms, get ALL participants who joined (including those who left)
			const allParticipants = await db
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
				.where(eq(roomParticipants.roomId, data.roomId))
				.orderBy(desc(roomParticipants.joinedAt));

			// Deduplicate by user ID (keep the earliest participation)
			const seenUsers = new Set<string>();
			participants = allParticipants.filter((p) => {
				if (seenUsers.has(p.user.id)) {
					return false;
				}
				seenUsers.add(p.user.id);
				return true;
			});

			participantCount = participants.length;
		} else {
			// For active rooms, get only currently active participants
			participants = await db
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

			participantCount = participants.length;
		}

		return {
			room: room[0],
			participants,
			participantCount,
			isEnded,
		};
	});
