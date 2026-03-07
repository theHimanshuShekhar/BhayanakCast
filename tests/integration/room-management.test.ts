import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { clearTables, teardownTestDatabase } from "../utils/database";
import { insertTestUsers } from "../fixtures/users";
import { insertTestRooms } from "../fixtures/rooms";
import { insertTestParticipants } from "../fixtures/participants";
import {
	getActiveRooms,
	getTrendingRooms,
	getCommunityStats,
	getGlobalStats,
} from "../../src/db/queries/stats";

describe("Room Management Integration (Direct DB Queries)", () => {
	beforeEach(async () => {
		const { db } = await import("../utils/database").then((m) =>
			m.getTestDatabase(),
		);
		await clearTables();
		await insertTestUsers(db);
		await insertTestRooms(db);
		await insertTestParticipants(db);
	});

	afterAll(async () => {
		await teardownTestDatabase();
	});

	describe("getActiveRooms", () => {
		it("returns all active rooms with streamer details", async () => {
			const rooms = await getActiveRooms();

			expect(rooms).toBeDefined();
			expect(rooms.length).toBeGreaterThan(0);
			expect(rooms[0].streamer).toBeDefined();
			expect(rooms[0].participantCount).toBeDefined();
		});

		it("performs full-text search on room names", async () => {
			const results = await getActiveRooms("gaming");
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].room.name.toLowerCase()).toContain("gaming");
		});

		it("performs full-text search on descriptions", async () => {
			const results = await getActiveRooms("playing");
			expect(results.length).toBeGreaterThan(0);
		});

		it("performs full-text search on streamer names", async () => {
			const results = await getActiveRooms("alice");
			expect(results.length).toBeGreaterThan(0);
		});

		it("returns empty array for no matches", async () => {
			const results = await getActiveRooms("xyznonexistent");
			expect(results).toHaveLength(0);
		});

		it("is case-insensitive", async () => {
			const resultsLower = await getActiveRooms("gaming");
			const resultsUpper = await getActiveRooms("GAMING");
			expect(resultsLower.length).toBe(resultsUpper.length);
		});
	});

	describe("getTrendingRooms", () => {
		it("returns rooms sorted by trending score", async () => {
			const rooms = await getTrendingRooms(5);
			expect(rooms.length).toBeGreaterThan(0);
			expect(rooms[0].trendingScore).toBeDefined();
			expect(rooms[0].viewerCount).toBeDefined();
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

	describe("getGlobalStats", () => {
		it("returns global site statistics", async () => {
			const stats = await getGlobalStats();
			expect(stats.totalRoomsCreated).toBeGreaterThanOrEqual(0);
			expect(stats.totalHoursStreamedToday).toBeGreaterThanOrEqual(0);
			expect(stats.peakConcurrentUsers).toBeGreaterThanOrEqual(0);
		});
	});
});
