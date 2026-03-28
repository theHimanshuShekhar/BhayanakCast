import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
	createRoomState,
	confirmRoomInDB,
	getRoomState,
	deleteRoomState,
	addParticipantToRoom,
	removeParticipantFromRoom,
	updateRoomStatus,
	updateRoomStreamer,
	getParticipantCount,
	isUserInRoom,
	getUserCurrentRoom,
	serializeRoomState,
	findStaleRooms,
	clearAllRoomStates,
	roomStates,
	type ParticipantState,
} from "../../websocket/room/state";

describe("Room State Management", () => {
	beforeEach(() => {
		clearAllRoomStates();
	});

	afterEach(() => {
		clearAllRoomStates();
	});

	describe("createRoomState", () => {
		it("should create a room with default values", () => {
			const room = createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date("2024-01-01"),
			});

			expect(room.id).toBe("room-1");
			expect(room.name).toBe("Test Room");
			expect(room.streamerId).toBeNull();
			expect(room.status).toBe("waiting");
			expect(room.participants.size).toBe(0);
			expect(room.dbConfirmed).toBe(false);
			expect(room.createdAt).toEqual(new Date("2024-01-01"));
		});

		it("should create a room with description", () => {
			const room = createRoomState({
				id: "room-2",
				name: "Test Room",
				description: "A test room description",
				streamerId: "user-1",
				status: "preparing",
				createdAt: new Date(),
			});

			expect(room.description).toBe("A test room description");
			expect(room.streamerId).toBe("user-1");
			expect(room.status).toBe("preparing");
		});

		it("should store room in global state", () => {
			createRoomState({
				id: "room-3",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			expect(roomStates.has("room-3")).toBe(true);
		});
	});

	describe("confirmRoomInDB", () => {
		it("should mark room as dbConfirmed", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			confirmRoomInDB("room-1");
			const room = getRoomState("room-1");

			expect(room?.dbConfirmed).toBe(true);
		});

		it("should not throw if room does not exist", () => {
			expect(() => confirmRoomInDB("non-existent")).not.toThrow();
		});
	});

	describe("getRoomState", () => {
		it("should return room by id", () => {
			const created = createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			const retrieved = getRoomState("room-1");

			expect(retrieved).toBe(created);
		});

		it("should return undefined for non-existent room", () => {
			const room = getRoomState("non-existent");

			expect(room).toBeUndefined();
		});
	});

	describe("deleteRoomState", () => {
		it("should remove room from state", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			const deleted = deleteRoomState("room-1");

			expect(deleted).toBe(true);
			expect(getRoomState("room-1")).toBeUndefined();
		});

		it("should return false for non-existent room", () => {
			const deleted = deleteRoomState("non-existent");

			expect(deleted).toBe(false);
		});
	});

	describe("addParticipantToRoom", () => {
		it("should add participant to room", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			const participant: ParticipantState = {
				userId: "user-1",
				userName: "Test User",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			};

			const result = addParticipantToRoom("room-1", participant);

			expect(result).toBe(true);
			const room = getRoomState("room-1");
			expect(room?.participants.has("user-1")).toBe(true);
			expect(room?.participants.get("user-1")).toEqual(participant);
		});

		it("should return false if room does not exist", () => {
			const participant: ParticipantState = {
				userId: "user-1",
				userName: "Test User",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			};

			const result = addParticipantToRoom("non-existent", participant);

			expect(result).toBe(false);
		});

		it("should return false if room is ended", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "ended",
				createdAt: new Date(),
			});

			const participant: ParticipantState = {
				userId: "user-1",
				userName: "Test User",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			};

			const result = addParticipantToRoom("room-1", participant);

			expect(result).toBe(false);
		});

		it("should update existing participant with same userId", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			const participant1: ParticipantState = {
				userId: "user-1",
				userName: "Old Name",
				socketId: "socket-1",
				joinedAt: new Date("2024-01-01"),
				isMobile: false,
			};

			const participant2: ParticipantState = {
				userId: "user-1",
				userName: "New Name",
				socketId: "socket-2",
				joinedAt: new Date("2024-01-02"),
				isMobile: true,
			};

			addParticipantToRoom("room-1", participant1);
			addParticipantToRoom("room-1", participant2);

			const room = getRoomState("room-1");
			expect(room?.participants.size).toBe(1);
			expect(room?.participants.get("user-1")?.userName).toBe("New Name");
			expect(room?.participants.get("user-1")?.socketId).toBe("socket-2");
		});
	});

	describe("removeParticipantFromRoom", () => {
		it("should remove participant from room", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			const participant: ParticipantState = {
				userId: "user-1",
				userName: "Test User",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			};

			addParticipantToRoom("room-1", participant);
			const removed = removeParticipantFromRoom("room-1", "user-1");

			expect(removed).toEqual(participant);
			const room = getRoomState("room-1");
			expect(room?.participants.has("user-1")).toBe(false);
		});

		it("should return undefined if participant not found", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			const removed = removeParticipantFromRoom("room-1", "user-1");

			expect(removed).toBeUndefined();
		});

		it("should return undefined if room does not exist", () => {
			const removed = removeParticipantFromRoom("non-existent", "user-1");

			expect(removed).toBeUndefined();
		});
	});

	describe("updateRoomStatus", () => {
		it("should update room status", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			const result = updateRoomStatus("room-1", "active");

			expect(result).toBe(true);
			const room = getRoomState("room-1");
			expect(room?.status).toBe("active");
		});

		it("should return false if room does not exist", () => {
			const result = updateRoomStatus("non-existent", "active");

			expect(result).toBe(false);
		});

		it("should handle all status transitions", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			updateRoomStatus("room-1", "preparing");
			expect(getRoomState("room-1")?.status).toBe("preparing");

			updateRoomStatus("room-1", "active");
			expect(getRoomState("room-1")?.status).toBe("active");

			updateRoomStatus("room-1", "ended");
			expect(getRoomState("room-1")?.status).toBe("ended");

			updateRoomStatus("room-1", "waiting");
			expect(getRoomState("room-1")?.status).toBe("waiting");
		});
	});

	describe("updateRoomStreamer", () => {
		it("should update streamer assignment", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			const result = updateRoomStreamer("room-1", "user-1");

			expect(result).toBe(true);
			const room = getRoomState("room-1");
			expect(room?.streamerId).toBe("user-1");
		});

		it("should set streamer to null", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: "user-1",
				status: "preparing",
				createdAt: new Date(),
			});

			updateRoomStreamer("room-1", null);

			const room = getRoomState("room-1");
			expect(room?.streamerId).toBeNull();
		});

		it("should return false if room does not exist", () => {
			const result = updateRoomStreamer("non-existent", "user-1");

			expect(result).toBe(false);
		});
	});

	describe("getParticipantCount", () => {
		it("should return 0 for empty room", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			const count = getParticipantCount("room-1");

			expect(count).toBe(0);
		});

		it("should return correct participant count", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			addParticipantToRoom("room-1", {
				userId: "user-1",
				userName: "User 1",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			});

			addParticipantToRoom("room-1", {
				userId: "user-2",
				userName: "User 2",
				socketId: "socket-2",
				joinedAt: new Date(),
				isMobile: false,
			});

			const count = getParticipantCount("room-1");

			expect(count).toBe(2);
		});

		it("should return 0 for non-existent room", () => {
			const count = getParticipantCount("non-existent");

			expect(count).toBe(0);
		});
	});

	describe("isUserInRoom", () => {
		it("should return true if user is in room", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			addParticipantToRoom("room-1", {
				userId: "user-1",
				userName: "User 1",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			});

			const result = isUserInRoom("room-1", "user-1");

			expect(result).toBe(true);
		});

		it("should return false if user is not in room", () => {
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			addParticipantToRoom("room-1", {
				userId: "user-1",
				userName: "User 1",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			});

			const result = isUserInRoom("room-1", "user-2");

			expect(result).toBe(false);
		});

		it("should return false if room does not exist", () => {
			const result = isUserInRoom("non-existent", "user-1");

			expect(result).toBe(false);
		});
	});

	describe("getUserCurrentRoom", () => {
		it("should return room if user is in it", () => {
			createRoomState({
				id: "room-1",
				name: "Room 1",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			addParticipantToRoom("room-1", {
				userId: "user-1",
				userName: "User 1",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			});

			const room = getUserCurrentRoom("user-1");

			expect(room?.id).toBe("room-1");
		});

		it("should return undefined if user is not in any room", () => {
			createRoomState({
				id: "room-1",
				name: "Room 1",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			const room = getUserCurrentRoom("user-1");

			expect(room).toBeUndefined();
		});

		it("should find user across multiple rooms", () => {
			createRoomState({
				id: "room-1",
				name: "Room 1",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			createRoomState({
				id: "room-2",
				name: "Room 2",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			addParticipantToRoom("room-2", {
				userId: "user-1",
				userName: "User 1",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			});

			const room = getUserCurrentRoom("user-1");

			expect(room?.id).toBe("room-2");
		});
	});

	describe("serializeRoomState", () => {
		it("should serialize room with participants", () => {
			const createdAt = new Date("2024-01-01");
			const joinedAt = new Date("2024-01-02");

			createRoomState({
				id: "room-1",
				name: "Test Room",
				description: "Test Description",
				streamerId: "user-1",
				status: "active",
				createdAt,
			});

			addParticipantToRoom("room-1", {
				userId: "user-1",
				userName: "Test User",
				userImage: "https://example.com/avatar.png",
				socketId: "socket-1",
				joinedAt,
				isMobile: false,
			});

			const serialized = serializeRoomState("room-1");

			expect(serialized).toEqual({
				id: "room-1",
				name: "Test Room",
				description: "Test Description",
				streamerId: "user-1",
				streamerPeerId: null,
				status: "active",
				participants: [
					{
						userId: "user-1",
						userName: "Test User",
						userImage: "https://example.com/avatar.png",
						joinedAt,
						isMobile: false,
						totalTimeSeconds: expect.any(Number),
					},
				],
				createdAt,
			});
		});

		it("should return null for non-existent room", () => {
			const serialized = serializeRoomState("non-existent");

			expect(serialized).toBeNull();
		});

		it("should calculate total time seconds correctly", () => {
			const joinedAt = new Date(Date.now() - 5000); // 5 seconds ago

			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			addParticipantToRoom("room-1", {
				userId: "user-1",
				userName: "Test User",
				socketId: "socket-1",
				joinedAt,
				isMobile: false,
			});

			const serialized = serializeRoomState("room-1");

			expect(serialized?.participants[0].totalTimeSeconds).toBeGreaterThanOrEqual(5);
			expect(serialized?.participants[0].totalTimeSeconds).toBeLessThanOrEqual(6);
		});
	});

	describe("findStaleRooms", () => {
		it("should find empty waiting rooms older than threshold", () => {
			const oldDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

			createRoomState({
				id: "stale-room",
				name: "Stale Room",
				streamerId: null,
				status: "waiting",
				createdAt: oldDate,
			});

			const stale = findStaleRooms(5);

			expect(stale).toHaveLength(1);
			expect(stale[0].id).toBe("stale-room");
			expect(stale[0].name).toBe("Stale Room");
		});

		it("should not find rooms with participants", () => {
			const oldDate = new Date(Date.now() - 10 * 60 * 1000);

			createRoomState({
				id: "active-room",
				name: "Active Room",
				streamerId: null,
				status: "waiting",
				createdAt: oldDate,
			});

			addParticipantToRoom("active-room", {
				userId: "user-1",
				userName: "User 1",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			});

			const stale = findStaleRooms(5);

			expect(stale).toHaveLength(0);
		});

		it("should not find non-waiting rooms", () => {
			const oldDate = new Date(Date.now() - 10 * 60 * 1000);

			createRoomState({
				id: "active-room",
				name: "Active Room",
				streamerId: "user-1",
				status: "active",
				createdAt: oldDate,
			});

			const stale = findStaleRooms(5);

			expect(stale).toHaveLength(0);
		});

		it("should not find recent rooms", () => {
			const recentDate = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago

			createRoomState({
				id: "recent-room",
				name: "Recent Room",
				streamerId: null,
				status: "waiting",
				createdAt: recentDate,
			});

			const stale = findStaleRooms(5);

			expect(stale).toHaveLength(0);
		});

		it("should use custom max age", () => {
			const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);

			createRoomState({
				id: "room-15min",
				name: "15 Min Room",
				streamerId: null,
				status: "waiting",
				createdAt: fifteenMinAgo,
			});

			// With 5 min threshold, should find it
			expect(findStaleRooms(5)).toHaveLength(1);

			// With 20 min threshold, should not find it
			expect(findStaleRooms(20)).toHaveLength(0);
		});
	});

	describe("clearAllRoomStates", () => {
		it("should remove all rooms", () => {
			createRoomState({
				id: "room-1",
				name: "Room 1",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			createRoomState({
				id: "room-2",
				name: "Room 2",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			expect(roomStates.size).toBe(2);

			clearAllRoomStates();

			expect(roomStates.size).toBe(0);
			expect(getRoomState("room-1")).toBeUndefined();
			expect(getRoomState("room-2")).toBeUndefined();
		});
	});

	describe("Room State Persistence", () => {
		it("should maintain state across multiple operations", () => {
			// Create room
			createRoomState({
				id: "room-1",
				name: "Test Room",
				streamerId: null,
				status: "waiting",
				createdAt: new Date(),
			});

			// Add participants
			addParticipantToRoom("room-1", {
				userId: "user-1",
				userName: "User 1",
				socketId: "socket-1",
				joinedAt: new Date(),
				isMobile: false,
			});

			addParticipantToRoom("room-1", {
				userId: "user-2",
				userName: "User 2",
				socketId: "socket-2",
				joinedAt: new Date(),
				isMobile: false,
			});

			// Update status
			updateRoomStatus("room-1", "active");

			// Update streamer
			updateRoomStreamer("room-1", "user-1");

			// Confirm in DB
			confirmRoomInDB("room-1");

			// Verify final state
			const room = getRoomState("room-1");
			expect(room?.status).toBe("active");
			expect(room?.streamerId).toBe("user-1");
			expect(room?.participants.size).toBe(2);
			expect(room?.dbConfirmed).toBe(true);

			// Remove participant
			removeParticipantFromRoom("room-1", "user-2");

			expect(getRoomState("room-1")?.participants.size).toBe(1);
		});
	});
});
