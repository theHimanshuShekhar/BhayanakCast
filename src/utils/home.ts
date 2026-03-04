import { createServerFn } from "@tanstack/react-start";
import { getTopRelationships } from "#/db/queries";
import {
	getActiveRooms,
	getCommunityStats,
	getEndedRooms,
	getGlobalStats,
	getTrendingRooms,
	getUserStats,
} from "#/db/queries/stats";

/**
 * Get all data needed for the home page
 */
export const getHomeData = createServerFn({ method: "GET" }).handler(
	async () => {
		const [activeRooms, trendingRooms, communityStats, globalStats] =
			await Promise.all([
				getActiveRooms(),
				getTrendingRooms(5),
				getCommunityStats(),
				getGlobalStats(),
			]);

		return {
			activeRooms,
			trendingRooms,
			communityStats,
			globalStats,
		};
	},
);

/**
 * Search rooms
 */
export const searchRooms = createServerFn({ method: "GET" })
	.inputValidator((data: { query: string }) => data)
	.handler(async ({ data }) => {
		const rooms = await getActiveRooms(data.query);
		return rooms;
	});

interface UserHomeStats {
	userStats: {
		totalWatchTime: number;
		totalRoomsJoined: number;
		totalConnections: number;
	};
	communityStats: {
		totalRegisteredUsers: number;
		totalWatchHoursThisWeek: number;
		mostActiveStreamers: number;
		newUsersThisWeek: number;
	};
}

/**
 * Get user stats
 */
export const getUserHomeStats = createServerFn({ method: "GET" })
	.inputValidator((data: { userId: string }) => data)
	.handler(async ({ data }): Promise<UserHomeStats> => {
		const [userStats, communityStats] = await Promise.all([
			getUserStats(data.userId),
			getCommunityStats(),
		]);

		return {
			userStats,
			communityStats,
		};
	});

/**
 * Get ended rooms
 */
export const getPastRooms = createServerFn({ method: "GET" })
	.inputValidator((data: { limit: number }) => data)
	.handler(async ({ data }) => {
		const rooms = await getEndedRooms(data.limit);
		return rooms;
	});

/**
 * Get top relationships for a user
 */
export const getUserTopRelationships = createServerFn({ method: "GET" })
	.inputValidator((data: { userId: string; limit?: number }) => data)
	.handler(async ({ data }) => {
		const relationships = await getTopRelationships(
			data.userId,
			data.limit ?? 5,
		);
		return relationships;
	});
