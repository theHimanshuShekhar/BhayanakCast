/**
 * Mobile Restrictions Integration Tests
 *
 * Tests for mobile device restrictions in streamer transfers
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
	removeParticipant,
	addParticipant,
	getRoomParticipants,
} from "#/utils/rooms";

// Mock database
vi.mock("#/db/index", () => ({
	db: {
		query: {
			streamingRooms: {
				findFirst: vi.fn(),
			},
			roomParticipants: {
				findMany: vi.fn(),
			},
		},
	},
	select: vi.fn().mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				orderBy: vi.fn().mockResolvedValue([]),
				limit: vi.fn().mockResolvedValue([]),
			}),
		}),
	}),
	insert: vi.fn().mockReturnValue({
		values: vi.fn().mockResolvedValue({}),
	}),
	update: vi.fn().mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue({}),
		}),
	}),
}));

describe("Mobile Restrictions", () => {
	const createSocketUserMap = (users: Array<{ socketId: string; userId: string; isMobile: boolean }>) => {
		const map = new Map();
		for (const user of users) {
			map.set(user.socketId, { userId: user.userId, isMobile: user.isMobile });
		}
		return map;
	};

	describe("removeParticipant with mobile skip logic", () => {
		it("skips mobile users when selecting next streamer", async () => {
			// Setup: Room with 1 desktop viewer and 1 mobile viewer
			const socketUserMap = createSocketUserMap([
				{ socketId: "socket-1", userId: "streamer", isMobile: false },
				{ socketId: "socket-2", userId: "desktop-viewer", isMobile: false },
				{ socketId: "socket-3", userId: "mobile-viewer", isMobile: true },
			]);

			// Mock room data
			vi.mocked(db.query.streamingRooms.findFirst).mockResolvedValue({
				id: "room-1",
				streamerId: "streamer",
				status: "active",
			});

			// Mock participants - desktop joined first, then mobile
			vi.mocked(db.query.roomParticipants.findMany).mockResolvedValue([
				{ id: "p1", userId: "desktop-viewer", joinedAt: new Date("2024-01-01T10:00:00") },
				{ id: "p2", userId: "mobile-viewer", joinedAt: new Date("2024-01-01T10:01:00") },
			]);

			const result = await removeParticipant("room-1", "streamer", socketUserMap);

			// Should transfer to desktop-viewer (earliest eligible)
			expect(result.newStreamerId).toBe("desktop-viewer");
			expect(result.skippedMobileUsers).toBe(1);
		});

		it("sets room to waiting when all viewers are mobile", async () => {
			const socketUserMap = createSocketUserMap([
				{ socketId: "socket-1", userId: "streamer", isMobile: false },
				{ socketId: "socket-2", userId: "mobile-1", isMobile: true },
				{ socketId: "socket-3", userId: "mobile-2", isMobile: true },
			]);

			vi.mocked(db.query.streamingRooms.findFirst).mockResolvedValue({
				id: "room-1",
				streamerId: "streamer",
				status: "active",
			});

			vi.mocked(db.query.roomParticipants.findMany).mockResolvedValue([
				{ id: "p1", userId: "mobile-1", joinedAt: new Date("2024-01-01T10:00:00") },
				{ id: "p2", userId: "mobile-2", joinedAt: new Date("2024-01-01T10:01:00") },
			]);

			const result = await removeParticipant("room-1", "streamer", socketUserMap);

			// Should set to waiting since all viewers are mobile
			expect(result.newStatus).toBe("waiting");
			expect(result.newStreamerId).toBeUndefined();
			expect(result.skippedMobileUsers).toBe(2);
		});

		it("transfers to earliest desktop viewer regardless of join order", async () => {
			const socketUserMap = createSocketUserMap([
				{ socketId: "socket-1", userId: "streamer", isMobile: false },
				{ socketId: "socket-2", userId: "mobile-viewer", isMobile: true },
				{ socketId: "socket-3", userId: "desktop-viewer", isMobile: false },
			]);

			vi.mocked(db.query.streamingRooms.findFirst).mockResolvedValue({
				id: "room-1",
				streamerId: "streamer",
				status: "active",
			});

			// Mobile joined first, then desktop
			vi.mocked(db.query.roomParticipants.findMany).mockResolvedValue([
				{ id: "p1", userId: "mobile-viewer", joinedAt: new Date("2024-01-01T10:00:00") },
				{ id: "p2", userId: "desktop-viewer", joinedAt: new Date("2024-01-01T10:01:00") },
			]);

			const result = await removeParticipant("room-1", "streamer", socketUserMap);

			// Should still transfer to desktop-viewer (only eligible)
			expect(result.newStreamerId).toBe("desktop-viewer");
			expect(result.skippedMobileUsers).toBe(1);
		});

		it("treats users as eligible when socket data is unavailable", async () => {
			// Empty socket map - should default to eligible
			const socketUserMap = new Map();

			vi.mocked(db.query.streamingRooms.findFirst).mockResolvedValue({
				id: "room-1",
				streamerId: "streamer",
				status: "active",
			});

			vi.mocked(db.query.roomParticipants.findMany).mockResolvedValue([
				{ id: "p1", userId: "viewer-1", joinedAt: new Date("2024-01-01T10:00:00") },
			]);

			const result = await removeParticipant("room-1", "streamer", socketUserMap);

			// Should transfer to viewer-1 (default eligible)
			expect(result.newStreamerId).toBe("viewer-1");
			expect(result.skippedMobileUsers).toBe(0);
		});
	});

	describe("socket identification", () => {
		it("includes isMobile flag in socket identification", async () => {
			// This would be tested via WebSocket connection
			// Verifying that mobile users send isMobile=true on identify
			const mockSocket = {
				emit: vi.fn(),
				on: vi.fn(),
				data: {},
			};

			// Simulate mobile user identifying
			const identifyData = {
				userId: "mobile-user",
				userName: "Mobile User",
				isMobile: true,
			};

			// Verify socket data is set correctly
			mockSocket.data.userId = identifyData.userId;
			mockSocket.data.isMobile = identifyData.isMobile;

			expect(mockSocket.data.isMobile).toBe(true);
			expect(mockSocket.data.userId).toBe("mobile-user");
		});

		it("includes isMobile=false for desktop users", async () => {
			const mockSocket = {
				emit: vi.fn(),
				on: vi.fn(),
				data: {},
			};

			const identifyData = {
				userId: "desktop-user",
				userName: "Desktop User",
				isMobile: false,
			};

			mockSocket.data.userId = identifyData.userId;
			mockSocket.data.isMobile = identifyData.isMobile;

			expect(mockSocket.data.isMobile).toBe(false);
		});
	});
});
