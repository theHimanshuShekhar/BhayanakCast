import { and, desc, gte, isNull, sql, sum } from "drizzle-orm";
import { db } from "#/db/index";
import {
	communityStatsSnapshots,
	roomParticipants,
	streamingRooms,
	users,
} from "#/db/schema";

export interface CommunityStats {
	totalRegisteredUsers: number;
	totalWatchHoursThisWeek: number;
	mostActiveStreamers: number;
	newUsersThisWeek: number;
	/** Total watch time in seconds (for accurate minute display) */
	totalWatchSecondsThisWeek: number;
}

/**
 * Calculate current community stats from database
 */
async function calculateCommunityStats(): Promise<CommunityStats> {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	// Total registered users
	const totalUsersResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(users);

	// Watch hours this week (last 7 days)
	// 1. Count completed sessions (users who left)
	const completedWatchResult = await db
		.select({ totalSeconds: sum(roomParticipants.totalTimeSeconds) })
		.from(roomParticipants)
		.where(gte(roomParticipants.leftAt, oneWeekAgo));

	// 2. Count ongoing sessions (users still in rooms who joined this week)
	const ongoingWatchResult = await db
		.select({
			totalSeconds: sum(
				sql<number>`extract(epoch from (now() - ${roomParticipants.joinedAt}))`,
			),
		})
		.from(roomParticipants)
		.where(
			and(
				isNull(roomParticipants.leftAt),
				gte(roomParticipants.joinedAt, oneWeekAgo),
			),
		);

	const totalWatchSeconds =
		(Number(completedWatchResult[0]?.totalSeconds) || 0) +
		(Number(ongoingWatchResult[0]?.totalSeconds) || 0);

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

	return {
		totalRegisteredUsers: Number(totalUsersResult[0]?.count) || 0,
		totalWatchHoursThisWeek: Math.round(totalWatchSeconds / 3600),
		totalWatchSecondsThisWeek: totalWatchSeconds,
		mostActiveStreamers: Number(activeStreamersResult[0]?.count) || 0,
		newUsersThisWeek: Number(newUsersResult[0]?.count) || 0,
	};
}

/**
 * Save calculated stats to database
 */
async function saveCommunityStats(stats: CommunityStats): Promise<void> {
	await db.insert(communityStatsSnapshots).values({
		id: crypto.randomUUID(),
		totalRegisteredUsers: stats.totalRegisteredUsers,
		totalWatchHoursThisWeek: stats.totalWatchHoursThisWeek,
		totalWatchSecondsThisWeek: stats.totalWatchSecondsThisWeek,
		mostActiveStreamers: stats.mostActiveStreamers,
		newUsersThisWeek: stats.newUsersThisWeek,
		calculatedAt: new Date(),
	});
}

/**
 * Calculate and save community stats to database
 * Call this once when the server starts
 */
export async function initializeCommunityStats(): Promise<CommunityStats> {
	console.log("[Community Stats] Calculating fresh stats...");
	const stats = await calculateCommunityStats();
	await saveCommunityStats(stats);
	console.log("[Community Stats] Stats calculated:", {
		totalRegisteredUsers: stats.totalRegisteredUsers,
		totalWatchSecondsThisWeek: stats.totalWatchSecondsThisWeek,
		totalWatchHoursThisWeek: stats.totalWatchHoursThisWeek,
	});
	return stats;
}

// In-memory cache to prevent recalculation on every request
let cachedStats: CommunityStats | null = null;
let lastCalculatedAt: number = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get the most recent stats snapshot from database
 * Auto-calculates if no stats exist or cache is stale
 */
export async function getCommunityStats(): Promise<CommunityStats> {
	// Check in-memory cache first
	if (cachedStats && Date.now() - lastCalculatedAt < CACHE_TTL_MS) {
		return cachedStats;
	}

	// Try to get from database
	const snapshot = await db
		.select()
		.from(communityStatsSnapshots)
		.orderBy(desc(communityStatsSnapshots.calculatedAt))
		.limit(1);

	if (snapshot.length === 0) {
		// No stats in DB, calculate now
		console.log("[Community Stats] No stats found, calculating...");
		const stats = await initializeCommunityStats();
		cachedStats = stats;
		lastCalculatedAt = Date.now();
		return stats;
	}

	// Check if DB stats are stale (> 30 mins old)
	const calculatedAt = snapshot[0].calculatedAt.getTime();
	if (Date.now() - calculatedAt > CACHE_TTL_MS) {
		console.log("[Community Stats] Stats are stale, recalculating...");
		const stats = await initializeCommunityStats();
		cachedStats = stats;
		lastCalculatedAt = Date.now();
		return stats;
	}

	// Use cached stats from DB
	const stats = {
		totalRegisteredUsers: snapshot[0].totalRegisteredUsers,
		totalWatchHoursThisWeek: snapshot[0].totalWatchHoursThisWeek,
		totalWatchSecondsThisWeek: snapshot[0].totalWatchSecondsThisWeek,
		mostActiveStreamers: snapshot[0].mostActiveStreamers,
		newUsersThisWeek: snapshot[0].newUsersThisWeek,
	};

	cachedStats = stats;
	lastCalculatedAt = calculatedAt;
	return stats;
}

/**
 * Cleanup old stats snapshots (keep only last 24 hours)
 * This can be run periodically to prevent table bloat
 */
export async function cleanupOldStatsSnapshots(): Promise<void> {
	const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

	await db
		.delete(communityStatsSnapshots)
		.where(sql`${communityStatsSnapshots.calculatedAt} < ${oneDayAgo}`);
}

/**
 * Clear all community stats snapshots
 * Use this to force recalculation on server restart
 */
export async function clearAllStatsSnapshots(): Promise<void> {
	await db.delete(communityStatsSnapshots);
}
