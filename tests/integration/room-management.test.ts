import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { clearTables, teardownTestDatabase, getTestDatabase } from "../utils/database";
import {
	getActiveRooms,
	getTrendingRooms,
	getCommunityStats,
	getGlobalStats,
} from "../../src/db/queries/stats";
import { users, streamingRooms, roomParticipants } from "../../src/db/schema";

// Helper to create test data
async function createTestData() {
	const { db } = await getTestDatabase();
	
	// Create test users
	await db.insert(users).values([
		{
			id: "test-user-1",
			name: "Alice Smith",
			email: "alice@test.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		{
			id: "test-user-2",
			name: "Bob Johnson",
			email: "bob@test.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	]);
	
	// Create test rooms
	await db.insert(streamingRooms).values([
		{
			id: "test-room-1",
			name: "Gaming Stream",
			description: "Playing games",
			streamerId: "test-user-1",
			status: "active",
			createdAt: new Date(),
			endedAt: null,
		},
		{
			id: "test-room-2",
			name: "Coding Session",
			description: "Building stuff",
			streamerId: "test-user-2",
			status: "preparing",
			createdAt: new Date(),
			endedAt: null,
		},
	]);
	
	// Create test participants
	await db.insert(roomParticipants).values([
		{
			id: "test-part-1",
			roomId: "test-room-1",
			userId: "test-user-1",
			joinedAt: new Date(),
			leftAt: null,
			totalTimeSeconds: 3600,
		},
		{
			id: "test-part-2",
			roomId: "test-room-1",
			userId: "test-user-2",
			joinedAt: new Date(),
			leftAt: null,
			totalTimeSeconds: 1800,
		},
	]);
}

describe("Room Management Integration (Direct DB Queries)", () => {
	beforeEach(async () => {
		await clearTables();
		await createTestData();
	});

	afterAll(async () => {
		await clearTables();
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
			// Should have at least the 3 test fixture users
			expect(stats.totalRegisteredUsers).toBeGreaterThanOrEqual(3);
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
