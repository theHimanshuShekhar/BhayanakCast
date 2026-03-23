import { and, desc, eq, gte, inArray, isNull, sql, sum } from "drizzle-orm";
import { db } from "#/db/index";
import {
	roomParticipants,
	streamingRooms,
	userRelationships,
	users,
} from "#/db/schema";

/**
 * Cache TTL: 30 minutes (in milliseconds)
 */
const CACHE_TTL = 30 * 60 * 1000;

/**
 * Short Cache TTL: 5 seconds for live room data (minimal cache for real-time updates)
 */
const SHORT_CACHE_TTL = 5 * 1000;

/**
 * Simple in-memory cache with TTL
 */
const cache = new Map<
	string,
	{ data: unknown; timestamp: number; ttl: number }
>();

function getCached<T>(key: string): T | undefined {
	const cached = cache.get(key);
	if (cached && Date.now() - cached.timestamp < cached.ttl) {
		return cached.data as T;
	}
	return undefined;
}

function setCached<T>(key: string, data: T, ttl: number = CACHE_TTL): void {
	cache.set(key, { data, timestamp: Date.now(), ttl });
}

interface UserStats {
	totalWatchTime: number;
	totalRoomsJoined: number;
	totalConnections: number;
}

import type { CommunityStats } from "#/db/queries/community-stats";

interface GlobalStats {
	totalRoomsCreated: number;
	totalHoursStreamedToday: number;
	peakConcurrentUsers: number;
}

interface RoomParticipant {
	id: string;
	name: string;
	image: string | null;
}

interface ActiveRoom {
	room: {
		id: string;
		name: string;
		description: string | null;
		streamerId: string | null;
		status: string;
		createdAt: Date;
		endedAt: Date | null;
	};
	streamer: {
		id: string;
		name: string;
		image: string | null;
	} | null;
	participantCount: number;
	streamerIsPresent: boolean;
	participants?: RoomParticipant[];
}

interface TrendingRoom {
	id: string;
	name: string;
	streamerName: string | null;
	viewerCount: number;
	trendingScore: number;
}

interface EndedRoom {
	room: {
		id: string;
		name: string;
		description: string | null;
		streamerId: string | null;
		status: string;
		createdAt: Date;
		endedAt: Date | null;
	};
	streamer: {
		id: string;
		name: string;
		image: string | null;
	} | null;
	maxUsersJoined: number;
}

/**
 * Get user's personal stats
 */
export async function getUserStats(userId: string): Promise<UserStats> {
	const cacheKey = `userStats:${userId}`;
	const cached = getCached<UserStats>(cacheKey);
	if (cached) return cached;

	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

	// Total watch time from roomParticipants
	const watchTimeResult = await db
		.select({ totalWatchTime: sum(roomParticipants.totalTimeSeconds) })
		.from(roomParticipants)
		.where(eq(roomParticipants.userId, userId));

	// Total unique rooms joined
	const roomsJoinedResult = await db
		.select({ count: sql<number>`count(distinct ${roomParticipants.roomId})` })
		.from(roomParticipants)
		.where(eq(roomParticipants.userId, userId));

	// Total connections (unique users met)
	const connectionsResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(userRelationships)
		.where(
			and(
				gte(userRelationships.lastInteractionAt, thirtyDaysAgo),
				sql`(${userRelationships.user1Id} = ${userId} OR ${userRelationships.user2Id} = ${userId})`,
			),
		);

	const stats = {
		totalWatchTime: Number(watchTimeResult[0]?.totalWatchTime) || 0,
		totalRoomsJoined: Number(roomsJoinedResult[0]?.count) || 0,
		totalConnections: Number(connectionsResult[0]?.count) || 0,
	};

	setCached(cacheKey, stats);
	return stats;
}

/**
 * Get global community stats (30-day rolling window)
 * Reads from pre-calculated database snapshots
 */
export async function getCommunityStats(): Promise<CommunityStats> {
	// Import dynamically to avoid circular dependency issues
	const { getCommunityStats: getCommunityStatsFromDB } = await import(
		"#/db/queries/community-stats"
	);
	return getCommunityStatsFromDB();
}

/**
 * Get global site stats (30-day rolling window)
 */
export async function getGlobalStats(): Promise<GlobalStats> {
	const cacheKey = "globalStats";
	const cached = getCached<GlobalStats>(cacheKey);
	if (cached) return cached;

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

	// Total active rooms (created in last 30 days)
	const roomsCreatedResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(streamingRooms)
		.where(gte(streamingRooms.createdAt, thirtyDaysAgo));

	// Total hours streamed today (since midnight)
	const hoursTodayResult = await db
		.select({ totalSeconds: sum(roomParticipants.totalTimeSeconds) })
		.from(roomParticipants)
		.where(gte(roomParticipants.joinedAt, today));

	// Peak concurrent users today (we'll calculate this from participant data)
	// For now, return a placeholder based on max participants in a room today
	const peakTodayResult = await db
		.select({ maxParticipants: sql<number>`max(count)` })
		.from(
			db
				.select({
					roomId: roomParticipants.roomId,
					count: sql<number>`count(*)`,
				})
				.from(roomParticipants)
				.where(gte(roomParticipants.joinedAt, today))
				.groupBy(roomParticipants.roomId)
				.as("roomCounts"),
		);

	const stats = {
		totalRoomsCreated: Number(roomsCreatedResult[0]?.count) || 0,
		totalHoursStreamedToday: Math.round(
			(Number(hoursTodayResult[0]?.totalSeconds) || 0) / 3600,
		),
		peakConcurrentUsers: Number(peakTodayResult[0]?.maxParticipants) || 0,
	};

	setCached(cacheKey, stats, SHORT_CACHE_TTL);
	return stats;
}

/**
 * Get active rooms with streamer details and participant counts
 * Also includes last 5 ended rooms for the "Past Streams" section
 */
export async function getActiveRooms(
	searchQuery?: string,
): Promise<ActiveRoom[]> {
	const cacheKey = `activeRooms:${searchQuery || "all"}`;
	const cached = getCached<ActiveRoom[]>(cacheKey);
	if (cached) return cached;

	// Build where conditions - fetch waiting, preparing, and active rooms
	const conditions = [
		sql`${streamingRooms.status} IN ('waiting', 'preparing', 'active')`,
	];

	if (searchQuery) {
		conditions.push(
			sql`(${streamingRooms.name} ILIKE ${`%${searchQuery}%`} OR ${streamingRooms.description} ILIKE ${`%${searchQuery}%`} OR ${users.name} ILIKE ${`%${searchQuery}%`})`,
		);
	}

	// Execute query for active rooms
	const activeRooms = await db
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
		.where(and(...conditions))
		.orderBy(desc(streamingRooms.createdAt));

	// Get last 6 ended rooms (only if not searching)
	let endedRooms: typeof activeRooms = [];
	const endedRoomParticipants: Map<string, RoomParticipant[]> = new Map();

	if (!searchQuery) {
		endedRooms = await db
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
			.where(eq(streamingRooms.status, "ended"))
			.orderBy(desc(streamingRooms.endedAt))
			.limit(6);

		// Fetch all participants who joined ended rooms (not just active ones)
		if (endedRooms.length > 0) {
			const endedRoomIds = endedRooms.map((r) => r.room.id);
			const allParticipants = await db
				.select({
					roomId: roomParticipants.roomId,
					userId: roomParticipants.userId,
				})
				.from(roomParticipants)
				.where(inArray(roomParticipants.roomId, endedRoomIds));

			// Get unique user IDs
			const userIds = [...new Set(allParticipants.map((p) => p.userId))];

			if (userIds.length > 0) {
				// Fetch user details
				const userDetails = await db
					.select({
						id: users.id,
						name: users.name,
						image: users.image,
					})
					.from(users)
					.where(inArray(users.id, userIds));

				// Group participants by room
				for (const room of endedRooms) {
					const roomParticipantIds = allParticipants
						.filter((p) => p.roomId === room.room.id)
						.map((p) => p.userId);

					const uniqueParticipantIds = [...new Set(roomParticipantIds)];

					const participantsList = uniqueParticipantIds
						.map((userId) => userDetails.find((u) => u.id === userId))
						.filter((u): u is RoomParticipant => u !== undefined);

					endedRoomParticipants.set(room.room.id, participantsList);
				}
			}
		}
	}

	// Combine active and ended rooms
	const rooms = [...activeRooms, ...endedRooms];

	// Get all active participants to check presence (only for non-ended rooms)
	const activeRoomIds = activeRooms.map((r) => r.room.id);
	let participants: Array<{ roomId: string; userId: string }> = [];

	if (activeRoomIds.length > 0) {
		participants = await db
			.select({
				roomId: roomParticipants.roomId,
				userId: roomParticipants.userId,
			})
			.from(roomParticipants)
			.where(
				and(
					inArray(roomParticipants.roomId, activeRoomIds),
					isNull(roomParticipants.leftAt),
				),
			);
	}

	// Build result with participant count and streamer presence check
	const result = rooms.map((room) => {
		const roomParticipants = participants.filter(
			(p) => p.roomId === room.room.id,
		);
		const participantCount = roomParticipants.length;
		const streamerId = room.streamer?.id;
		const streamerIsPresent = streamerId
			? roomParticipants.some((p) => p.userId === streamerId)
			: false;

		// For ended rooms, include the participants list
		const participantsList =
			room.room.status === "ended"
				? endedRoomParticipants.get(room.room.id)
				: undefined;

		return {
			...room,
			participantCount: participantsList?.length || participantCount,
			streamerIsPresent,
			participants: participantsList,
		};
	});

	setCached(cacheKey, result, SHORT_CACHE_TTL);
	return result;
}

/**
 * Get trending rooms using time-weighted + viewer count algorithm
 * Formula: (viewerCount * 0.6) + (recencyScore * 0.4)
 * where recencyScore = max(100 - hoursSinceStart, 0)
 */
export async function getTrendingRooms(
	limit: number = 5,
): Promise<TrendingRoom[]> {
	const cacheKey = `trendingRooms:${limit}`;
	const cached = getCached<TrendingRoom[]>(cacheKey);
	if (cached) return cached;

	const now = new Date();

	// Get active and preparing rooms with streamer info
	const rooms = await db
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
		.where(sql`${streamingRooms.status} IN ('waiting', 'preparing', 'active')`);

	// Get participant counts
	const roomIds = rooms.map((r) => r.room.id);
	let participantCounts: Array<{ roomId: string; count: number }> = [];

	if (roomIds.length > 0) {
		participantCounts = await db
			.select({
				roomId: roomParticipants.roomId,
				count: sql<number>`count(*)`,
			})
			.from(roomParticipants)
			.where(
				and(
					inArray(roomParticipants.roomId, roomIds),
					isNull(roomParticipants.leftAt),
				),
			)
			.groupBy(roomParticipants.roomId);
	}

	// Calculate trending scores
	const roomsWithScore = rooms.map((room) => {
		const viewerCount =
			participantCounts.find((pc) => pc.roomId === room.room.id)?.count || 0;
		const hoursSinceStart =
			(now.getTime() - new Date(room.room.createdAt).getTime()) /
			(1000 * 60 * 60);
		const recencyScore = Math.max(100 - hoursSinceStart, 0);
		const trendingScore = viewerCount * 0.6 + recencyScore * 0.4;

		return {
			id: room.room.id,
			name: room.room.name,
			streamerName: room.streamer?.name ?? "No Streamer",
			viewerCount,
			trendingScore,
		};
	});

	// Sort by trending score and return top N
	const result = roomsWithScore
		.sort((a, b) => b.trendingScore - a.trendingScore)
		.slice(0, limit);

	setCached(cacheKey, result);
	return result;
}

/**
 * Get ended rooms with max participant counts
 */
export async function getEndedRooms(limit: number = 6): Promise<EndedRoom[]> {
	const cacheKey = `endedRooms:${limit}`;
	const cached = getCached<EndedRoom[]>(cacheKey);
	if (cached) return cached;

	const rooms = await db
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
		.where(eq(streamingRooms.status, "ended"))
		.orderBy(desc(streamingRooms.endedAt))
		.limit(limit);

	// Get max participant counts for each room
	const roomIds = rooms.map((r) => r.room.id);
	const maxParticipants: Array<{ roomId: string; count: number }> = [];

	if (roomIds.length > 0) {
		const counts = await db
			.select({
				roomId: roomParticipants.roomId,
				count: sql<number>`count(*)`,
			})
			.from(roomParticipants)
			.where(inArray(roomParticipants.roomId, roomIds))
			.groupBy(roomParticipants.roomId);
		maxParticipants.push(...counts);
	}

	const result = rooms.map((room) => ({
		...room,
		maxUsersJoined:
			maxParticipants.find((mp) => mp.roomId === room.room.id)?.count || 0,
	}));

	setCached(cacheKey, result);
	return result;
}
