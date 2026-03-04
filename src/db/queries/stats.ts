import { and, desc, eq, gte, sql, sum } from "drizzle-orm";
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
 * Simple in-memory cache with TTL
 */
const cache = new Map<string, { data: unknown; timestamp: number }>();

function getCached<T>(key: string): T | undefined {
	const cached = cache.get(key);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
		return cached.data as T;
	}
	return undefined;
}

function setCached<T>(key: string, data: T): void {
	cache.set(key, { data, timestamp: Date.now() });
}

interface UserStats {
	totalWatchTime: number;
	totalRoomsJoined: number;
	totalConnections: number;
}

interface CommunityStats {
	totalRegisteredUsers: number;
	totalWatchHoursThisWeek: number;
	mostActiveStreamers: number;
	newUsersThisWeek: number;
}

interface GlobalStats {
	totalRoomsCreated: number;
	totalHoursStreamedToday: number;
	peakConcurrentUsers: number;
}

interface ActiveRoom {
	room: {
		id: string;
		name: string;
		description: string | null;
		streamerId: string;
		status: string;
		createdAt: Date;
		endedAt: Date | null;
	};
	streamer: {
		id: string;
		name: string;
		image: string | null;
	};
	participantCount: number;
}

interface TrendingRoom {
	id: string;
	name: string;
	streamerName: string;
	viewerCount: number;
	trendingScore: number;
}

interface EndedRoom {
	room: {
		id: string;
		name: string;
		description: string | null;
		streamerId: string;
		status: string;
		createdAt: Date;
		endedAt: Date | null;
	};
	streamer: {
		id: string;
		name: string;
		image: string | null;
	};
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
 */
export async function getCommunityStats(): Promise<CommunityStats> {
	const cacheKey = "communityStats";
	const cached = getCached<CommunityStats>(cacheKey);
	if (cached) return cached;

	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	// Total registered users
	const totalUsersResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(users);

	// Watch hours this week (last 7 days)
	const watchHoursResult = await db
		.select({ totalSeconds: sum(roomParticipants.totalTimeSeconds) })
		.from(roomParticipants)
		.where(gte(roomParticipants.joinedAt, oneWeekAgo));

	// Active streamers (users who have streamed in last 30 days)
	const activeStreamersResult = await db
		.select({
			count: sql<number>`count(distinct ${streamingRooms.streamerId})`,
		})
		.from(streamingRooms)
		.where(gte(streamingRooms.createdAt, thirtyDaysAgo));

	// New users this week
	const newUsersResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(users)
		.where(gte(users.createdAt, oneWeekAgo));

	const stats = {
		totalRegisteredUsers: Number(totalUsersResult[0]?.count) || 0,
		totalWatchHoursThisWeek: Math.round(
			(Number(watchHoursResult[0]?.totalSeconds) || 0) / 3600,
		),
		mostActiveStreamers: Number(activeStreamersResult[0]?.count) || 0,
		newUsersThisWeek: Number(newUsersResult[0]?.count) || 0,
	};

	setCached(cacheKey, stats);
	return stats;
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

	setCached(cacheKey, stats);
	return stats;
}

/**
 * Get active rooms with streamer details and participant counts
 */
export async function getActiveRooms(
	searchQuery?: string,
): Promise<ActiveRoom[]> {
	const cacheKey = `activeRooms:${searchQuery || "all"}`;
	const cached = getCached<ActiveRoom[]>(cacheKey);
	if (cached) return cached;

	// Build where conditions
	const conditions = [eq(streamingRooms.status, "active")];

	if (searchQuery) {
		conditions.push(
			sql`(${streamingRooms.name} ILIKE ${`%${searchQuery}%`} OR ${streamingRooms.description} ILIKE ${`%${searchQuery}%`} OR ${users.name} ILIKE ${`%${searchQuery}%`})`,
		);
	}

	// Execute query with all conditions
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
		.innerJoin(users, eq(streamingRooms.streamerId, users.id))
		.where(and(...conditions))
		.orderBy(desc(streamingRooms.createdAt));

	// Get participant counts for each room
	const roomIds = rooms.map((r) => r.room.id);
	let participantCounts: Array<{ roomId: string; count: number }> = [];

	if (roomIds.length > 0) {
		participantCounts = await db
			.select({
				roomId: roomParticipants.roomId,
				count: sql<number>`count(*)`,
			})
			.from(roomParticipants)
			.where(sql`${roomParticipants.roomId} IN (${sql.join(roomIds)})`)
			.groupBy(roomParticipants.roomId);
	}

	const result = rooms.map((room) => ({
		...room,
		participantCount:
			participantCounts.find((pc) => pc.roomId === room.room.id)?.count || 0,
	}));

	setCached(cacheKey, result);
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

	// Get active rooms with streamer info
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
		.innerJoin(users, eq(streamingRooms.streamerId, users.id))
		.where(eq(streamingRooms.status, "active"));

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
			.where(sql`${roomParticipants.roomId} IN (${sql.join(roomIds)})`)
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
			streamerName: room.streamer.name,
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
export async function getEndedRooms(limit: number = 10): Promise<EndedRoom[]> {
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
		.innerJoin(users, eq(streamingRooms.streamerId, users.id))
		.where(eq(streamingRooms.status, "ended"))
		.orderBy(desc(streamingRooms.endedAt))
		.limit(limit);

	// Get max participant counts for each room
	const roomIds = rooms.map((r) => r.room.id);
	let maxParticipants: Array<{ roomId: string; count: number }> = [];

	if (roomIds.length > 0) {
		maxParticipants = await db
			.select({
				roomId: roomParticipants.roomId,
				count: sql<number>`count(*)`,
			})
			.from(roomParticipants)
			.where(sql`${roomParticipants.roomId} IN (${sql.join(roomIds)})`)
			.groupBy(roomParticipants.roomId);
	}

	const result = rooms.map((room) => ({
		...room,
		maxUsersJoined:
			maxParticipants.find((mp) => mp.roomId === room.room.id)?.count || 0,
	}));

	setCached(cacheKey, result);
	return result;
}
