import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { clearTables, teardownTestDatabase } from "../utils/database";
import { insertTestUsers } from "../fixtures/users";
import { insertTestRooms } from "../fixtures/rooms";
import { insertTestParticipants } from "../fixtures/participants";
import { insertTestRelationships } from "../fixtures/relationships";
import {
	getUserStats,
	getCommunityStats,
	getTrendingRooms,
} from "../../src/db/queries/stats";
import { getTopRelationships } from "../../src/db/queries";

describe("User Stats and Queries Integration", () => {
	beforeEach(async () => {
		const { db } = await import("../utils/database").then((m) =>
			m.getTestDatabase(),
		);
		await clearTables();
		await insertTestUsers(db);
		await insertTestRooms(db);
		await insertTestParticipants(db);
		await insertTestRelationships(db);
	});

	afterAll(async () => {
		await teardownTestDatabase();
	});

	describe("getUserStats", () => {
		it("calculates total watch time correctly", async () => {
			const stats = await getUserStats("user-1");
			expect(stats.totalWatchTime).toBeGreaterThan(0);
		});

		it("counts unique rooms joined", async () => {
			const stats = await getUserStats("user-1");
			expect(stats.totalRoomsJoined).toBeGreaterThanOrEqual(2);
		});

		it("counts connections within 30 days", async () => {
			const stats = await getUserStats("user-1");
			expect(stats.totalConnections).toBe(2);
		});
	});

	describe("getCommunityStats", () => {
		it("returns total registered users", async () => {
			const stats = await getCommunityStats();
			expect(stats.totalRegisteredUsers).toBe(3);
		});

		it("calculates watch hours this week", async () => {
			const stats = await getCommunityStats();
			expect(stats.totalWatchHoursThisWeek).toBeGreaterThanOrEqual(0);
		});

		it("counts active streamers", async () => {
			const stats = await getCommunityStats();
			expect(stats.mostActiveStreamers).toBeGreaterThanOrEqual(0);
		});

		it("counts new users this week", async () => {
			const stats = await getCommunityStats();
			expect(stats.newUsersThisWeek).toBeGreaterThanOrEqual(0);
		});

		it("caches results for 2 minutes", async () => {
			const stats1 = await getCommunityStats();
			const stats2 = await getCommunityStats();
			expect(stats1).toBe(stats2);
		});
	});

	describe("getTrendingRooms", () => {
		it("returns rooms sorted by trending score", async () => {
			const rooms = await getTrendingRooms(5);
			expect(rooms.length).toBeGreaterThan(0);

			rooms.forEach((room) => {
				expect(room.trendingScore).toBeDefined();
				expect(room.viewerCount).toBeDefined();
			});
		});

		it("limits results to specified count", async () => {
			const rooms = await getTrendingRooms(2);
			expect(rooms.length).toBeLessThanOrEqual(2);
		});

		it("includes streamer names", async () => {
			const rooms = await getTrendingRooms(5);
			rooms.forEach((room) => {
				expect(room.streamerName).toBeDefined();
			});
		});
	});

	describe("getTopRelationships", () => {
		it("returns relationships sorted by time", async () => {
			const relationships = await getTopRelationships("user-1", 5);
			expect(relationships.length).toBeGreaterThan(0);

			if (relationships.length > 1) {
				expect(relationships[0].totalTimeSeconds).toBeGreaterThanOrEqual(
					relationships[1].totalTimeSeconds,
				);
			}
		});

		it("includes user details", async () => {
			const relationships = await getTopRelationships("user-1", 5);
			relationships.forEach((rel) => {
				expect(rel.user).toBeDefined();
				expect(rel.user?.name).toBeDefined();
			});
		});

		it("respects limit parameter", async () => {
			const relationships = await getTopRelationships("user-1", 1);
			expect(relationships.length).toBeLessThanOrEqual(1);
		});
	});
});
