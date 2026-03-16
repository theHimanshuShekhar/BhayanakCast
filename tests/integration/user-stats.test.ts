import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { clearTables, teardownTestDatabase, getTestDatabase } from "../utils/database";
import {
	getUserStats,
	getCommunityStats,
	getTrendingRooms,
} from "../../src/db/queries/stats";
import { getTopRelationships } from "../../src/db/queries";
import { resetCommunityStatsCache } from "../../src/db/queries/community-stats";
import { users, streamingRooms, roomParticipants, userRelationships } from "../../src/db/schema";

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
		{
			id: "test-user-3",
			name: "Carol Williams",
			email: "carol@test.com",
			emailVerified: false,
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
		{
			id: "test-part-3",
			roomId: "test-room-2",
			userId: "test-user-1",
			joinedAt: new Date(),
			leftAt: null,
			totalTimeSeconds: 2400,
		},
	]);

	// Create test relationships
	await db.insert(userRelationships).values([
		{
			user1Id: "test-user-1",
			user2Id: "test-user-2",
			totalTimeSeconds: 1800,
			roomsCount: 1,
			lastInteractionAt: new Date(),
			updatedAt: new Date(),
		},
		{
			user1Id: "test-user-1",
			user2Id: "test-user-3",
			totalTimeSeconds: 900,
			roomsCount: 1,
			lastInteractionAt: new Date(),
			updatedAt: new Date(),
		},
	]);
}

describe("User Stats and Queries Integration", () => {
	beforeEach(async () => {
		await clearTables();
		resetCommunityStatsCache(); // Reset cache to ensure fresh stats calculation
		await createTestData();
	});

	afterAll(async () => {
		await clearTables();
		await teardownTestDatabase();
	});

	describe("getUserStats", () => {
		it("calculates total watch time correctly", async () => {
			const stats = await getUserStats("test-user-1");
			expect(stats.totalWatchTime).toBeGreaterThan(0);
		});

		it("counts unique rooms joined", async () => {
			const stats = await getUserStats("test-user-1");
			expect(stats.totalRoomsJoined).toBeGreaterThanOrEqual(2);
		});

		it("counts connections within 30 days", async () => {
			const stats = await getUserStats("test-user-1");
			expect(stats.totalConnections).toBe(2);
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
			const relationships = await getTopRelationships("test-user-1", 5);
			expect(relationships.length).toBeGreaterThan(0);

			if (relationships.length > 1) {
				expect(relationships[0].totalTimeSeconds).toBeGreaterThanOrEqual(
					relationships[1].totalTimeSeconds,
				);
			}
		});

		it("includes user details", async () => {
			const relationships = await getTopRelationships("test-user-1", 5);
			relationships.forEach((rel) => {
				expect(rel.user).toBeDefined();
				expect(rel.user?.name).toBeDefined();
			});
		});

		it("respects limit parameter", async () => {
			const relationships = await getTopRelationships("test-user-1", 1);
			expect(relationships.length).toBeLessThanOrEqual(1);
		});
	});
});
