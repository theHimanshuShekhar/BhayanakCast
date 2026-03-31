/**
 * Streaming Event Handlers Unit Tests
 *
 * Covers: peerjs:ready, peerjs:streamer_ready, peerjs:screen_share_ended,
 * rate-limit enforcement, getPeerIdForUser, removePeerId, initiateStreamerTransfer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	setupStreamingHandlers,
	getPeerIdForUser,
	removePeerId,
	initiateStreamerTransfer,
} from "../../../websocket/streaming/events";
import type { SocketUserData } from "../../../websocket/websocket-server";

// ─── Mock room/state (dynamic imports inside event handlers) ──────────────────

const mockGetRoomState = vi.fn();
const mockUpdateRoomStatus = vi.fn();
const mockSerializeRoomState = vi.fn();

vi.mock("../../../websocket/room/state", () => ({
	getRoomState: (...args: unknown[]) => mockGetRoomState(...args),
	updateRoomStatus: (...args: unknown[]) => mockUpdateRoomStatus(...args),
	serializeRoomState: (...args: unknown[]) => mockSerializeRoomState(...args),
}));

// ─── Mock rate-limiter ────────────────────────────────────────────────────────

const { mockCheckAndRecord, mockForAction } = vi.hoisted(() => {
	const mockCheckAndRecord = vi.fn().mockReturnValue({ allowed: true, retryAfter: 0 });
	const mockForAction = vi.fn(() => ({ checkAndRecord: mockCheckAndRecord }));
	return { mockCheckAndRecord, mockForAction };
});

vi.mock("../../../src/lib/rate-limiter", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../../src/lib/rate-limiter")>();
	return {
		...original,
		rateLimiter: { forAction: mockForAction },
	};
});

// ─── Test helpers ─────────────────────────────────────────────────────────────

type EventHandler = (data?: unknown) => void | Promise<void>;

function makeSocket(userId = "user-1") {
	const handlers: Record<string, EventHandler> = {};
	const socket = {
		id: `socket-${userId}`,
		data: { userId, userName: `User ${userId}`, userImage: null, roomId: null, isMobile: false } as SocketUserData,
		on: vi.fn((event: string, handler: EventHandler) => { handlers[event] = handler; }),
		emit: vi.fn(),
		_handlers: handlers,
	};
	return socket;
}

function makeIo() {
	const roomEmits: Record<string, unknown[]> = {};
	return {
		to: vi.fn((roomId: string) => ({
			emit: vi.fn((event: string, data: unknown) => {
				if (!roomEmits[event]) roomEmits[event] = [];
				roomEmits[event].push(data);
			}),
		})),
		_roomEmits: roomEmits,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("setupStreamingHandlers", () => {
	let socket: ReturnType<typeof makeSocket>;
	let io: ReturnType<typeof makeIo>;
	let socketUserMap: Map<string, SocketUserData>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockCheckAndRecord.mockReturnValue({ allowed: true, retryAfter: 0 });
		socket = makeSocket("user-1");
		io = makeIo();
		socketUserMap = new Map();
		socketUserMap.set(socket.id, { ...socket.data });
	});

	// ─── peerjs:ready ─────────────────────────────────────────────────────────

	describe("peerjs:ready", () => {
		it("stores peerId in socketUserMap entry for the socket", () => {
			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			socket._handlers["peerjs:ready"]?.({ peerId: "peer-abc" });

			expect(socketUserMap.get(socket.id)?.peerId).toBe("peer-abc");
		});

		it("does nothing when no entry exists in socketUserMap", () => {
			socketUserMap.clear(); // Remove the entry
			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			// Should not throw
			expect(() => socket._handlers["peerjs:ready"]?.({ peerId: "peer-abc" })).not.toThrow();
		});

		it("blocks the event when rate limit is exceeded", () => {
			mockCheckAndRecord.mockReturnValue({ allowed: false, retryAfter: 5 });
			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			socket._handlers["peerjs:ready"]?.({ peerId: "peer-abc" });

			// peerId should NOT be stored
			expect(socketUserMap.get(socket.id)?.peerId).toBeUndefined();
			expect(socket.emit).toHaveBeenCalledWith("room:error", expect.objectContaining({ message: expect.stringContaining("5") }));
		});
	});

	// ─── peerjs:streamer_ready ────────────────────────────────────────────────

	describe("peerjs:streamer_ready", () => {
		it("updates socketUserMap and emits peerjs:streamer_ready to room", async () => {
			const room = { id: "room-1", streamerId: "user-1", streamerPeerId: null };
			mockGetRoomState.mockReturnValue(room);
			mockSerializeRoomState.mockReturnValue({ id: "room-1" });

			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			await socket._handlers["peerjs:streamer_ready"]?.({
				roomId: "room-1",
				peerId: "peer-xyz",
				audioConfig: "system",
			});

			expect(socketUserMap.get(socket.id)?.peerId).toBe("peer-xyz");
		});

		it("sets room.streamerPeerId when caller is the streamer", async () => {
			const room = { id: "room-1", streamerId: "user-1", streamerPeerId: null };
			mockGetRoomState.mockReturnValue(room);
			mockSerializeRoomState.mockReturnValue({ id: "room-1" });

			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			await socket._handlers["peerjs:streamer_ready"]?.({
				roomId: "room-1",
				peerId: "peer-xyz",
				audioConfig: "system",
			});

			expect(room.streamerPeerId).toBe("peer-xyz");
		});

		it("does NOT set streamerPeerId when caller is not the streamer", async () => {
			const room = { id: "room-1", streamerId: "other-user", streamerPeerId: null };
			mockGetRoomState.mockReturnValue(room);

			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			await socket._handlers["peerjs:streamer_ready"]?.({
				roomId: "room-1",
				peerId: "peer-xyz",
				audioConfig: "system",
			});

			expect(room.streamerPeerId).toBeNull();
		});

		it("broadcasts room:state_sync when streamerPeerId is updated", async () => {
			const room = { id: "room-1", streamerId: "user-1", streamerPeerId: null };
			mockGetRoomState.mockReturnValue(room);
			mockSerializeRoomState.mockReturnValue({ id: "room-1", streamerPeerId: "peer-xyz" });

			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			await socket._handlers["peerjs:streamer_ready"]?.({
				roomId: "room-1",
				peerId: "peer-xyz",
				audioConfig: "system",
			});

			expect(io.to).toHaveBeenCalledWith("room-1");
		});

		it("blocks the event when rate limit is exceeded", async () => {
			mockCheckAndRecord.mockReturnValue({ allowed: false, retryAfter: 10 });

			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			await socket._handlers["peerjs:streamer_ready"]?.({
				roomId: "room-1",
				peerId: "peer-xyz",
				audioConfig: "system",
			});

			expect(socket.emit).toHaveBeenCalledWith("room:error", expect.objectContaining({ message: expect.stringContaining("10") }));
			// io.to should NOT have been called
			expect(io.to).not.toHaveBeenCalled();
		});
	});

	// ─── peerjs:screen_share_ended ────────────────────────────────────────────

	describe("peerjs:screen_share_ended", () => {
		it("calls updateRoomStatus('preparing') and clears streamerPeerId", async () => {
			const room = { id: "room-1", streamerId: "user-1", streamerPeerId: "peer-xyz" };
			mockGetRoomState.mockReturnValue(room);
			mockSerializeRoomState.mockReturnValue({ id: "room-1" });

			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			await socket._handlers["peerjs:screen_share_ended"]?.({ roomId: "room-1" });

			expect(mockUpdateRoomStatus).toHaveBeenCalledWith("room-1", "preparing");
			expect(room.streamerPeerId).toBeNull();
		});

		it("emits room:status_changed and peerjs:screen_share_ended to room", async () => {
			const room = { id: "room-1", streamerId: "user-1", streamerPeerId: "peer-xyz" };
			mockGetRoomState.mockReturnValue(room);
			mockSerializeRoomState.mockReturnValue({ id: "room-1" });

			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			await socket._handlers["peerjs:screen_share_ended"]?.({ roomId: "room-1" });

			// io.to("room-1") should have been called multiple times (status_changed, screen_share_ended, state_sync)
			expect(io.to).toHaveBeenCalledWith("room-1");
		});

		it("ignores the event if the caller is not the current streamer", async () => {
			const room = { id: "room-1", streamerId: "someone-else", streamerPeerId: "peer-xyz" };
			mockGetRoomState.mockReturnValue(room);

			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			await socket._handlers["peerjs:screen_share_ended"]?.({ roomId: "room-1" });

			expect(mockUpdateRoomStatus).not.toHaveBeenCalled();
			expect(room.streamerPeerId).toBe("peer-xyz"); // unchanged
		});

		it("ignores the event if the room does not exist", async () => {
			mockGetRoomState.mockReturnValue(null);

			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			await socket._handlers["peerjs:screen_share_ended"]?.({ roomId: "room-1" });

			expect(mockUpdateRoomStatus).not.toHaveBeenCalled();
		});

		it("blocks the event when rate limit is exceeded", async () => {
			mockCheckAndRecord.mockReturnValue({ allowed: false, retryAfter: 3 });

			setupStreamingHandlers(io as never, socket as never, socketUserMap);

			await socket._handlers["peerjs:screen_share_ended"]?.({ roomId: "room-1" });

			expect(socket.emit).toHaveBeenCalledWith("room:error", expect.objectContaining({ message: expect.stringContaining("3") }));
			expect(mockUpdateRoomStatus).not.toHaveBeenCalled();
		});
	});
});

// ─── getPeerIdForUser ─────────────────────────────────────────────────────────

describe("getPeerIdForUser", () => {
	beforeEach(() => {
		// Clean up any state left by previous tests
		removePeerId("test-room", "user-A");
		removePeerId("test-room", "user-B");
	});

	it("returns undefined when no peerId has been registered", () => {
		expect(getPeerIdForUser("test-room", "user-A")).toBeUndefined();
	});

	it("returns the registered peerId after a streamer_ready call", async () => {
		const socket = makeSocket("user-A");
		const socketUserMap = new Map<string, SocketUserData>();
		socketUserMap.set(socket.id, { ...socket.data, userId: "user-A" });

		const room = { id: "test-room", streamerId: "user-A", streamerPeerId: null };
		mockGetRoomState.mockReturnValue(room);
		mockSerializeRoomState.mockReturnValue({ id: "test-room" });
		mockCheckAndRecord.mockReturnValue({ allowed: true, retryAfter: 0 });

		const io = makeIo();
		setupStreamingHandlers(io as never, socket as never, socketUserMap);

		await socket._handlers["peerjs:streamer_ready"]?.({
			roomId: "test-room",
			peerId: "peer-for-user-A",
			audioConfig: "system",
		});

		expect(getPeerIdForUser("test-room", "user-A")).toBe("peer-for-user-A");

		removePeerId("test-room", "user-A");
	});
});

// ─── removePeerId ─────────────────────────────────────────────────────────────

describe("removePeerId", () => {
	it("does nothing when entry does not exist", () => {
		expect(() => removePeerId("room-x", "user-x")).not.toThrow();
	});

	it("cleans up empty room map entries after last user removed", async () => {
		const socket = makeSocket("solo-user");
		const socketUserMap = new Map<string, SocketUserData>();
		socketUserMap.set(socket.id, { ...socket.data, userId: "solo-user" });

		const room = { id: "solo-room", streamerId: "solo-user", streamerPeerId: null };
		mockGetRoomState.mockReturnValue(room);
		mockSerializeRoomState.mockReturnValue({ id: "solo-room" });
		mockCheckAndRecord.mockReturnValue({ allowed: true, retryAfter: 0 });

		const io = makeIo();
		setupStreamingHandlers(io as never, socket as never, socketUserMap);

		await socket._handlers["peerjs:streamer_ready"]?.({
			roomId: "solo-room",
			peerId: "peer-solo",
			audioConfig: "system",
		});

		expect(getPeerIdForUser("solo-room", "solo-user")).toBe("peer-solo");

		removePeerId("solo-room", "solo-user");

		// After removal, should return undefined
		expect(getPeerIdForUser("solo-room", "solo-user")).toBeUndefined();
	});
});

// ─── initiateStreamerTransfer ─────────────────────────────────────────────────

describe("initiateStreamerTransfer", () => {
	it("emits peerjs:streamer_changed to the room", async () => {
		const io = makeIo();

		await initiateStreamerTransfer(io as never, "room-1", "user-2", [
			{ userId: "user-1", userName: "Alice" },
			{ userId: "user-2", userName: "Bob" },
		]);

		expect(io.to).toHaveBeenCalledWith("room-1");
	});

	it("includes newStreamerName in the emitted payload", async () => {
		let emittedData: unknown;
		const io = {
			to: vi.fn(() => ({
				emit: vi.fn((event: string, data: unknown) => {
					if (event === "peerjs:streamer_changed") emittedData = data;
				}),
			})),
		};

		await initiateStreamerTransfer(io as never, "room-1", "user-2", [
			{ userId: "user-2", userName: "NewStreamer" },
		]);

		expect(emittedData).toMatchObject({ newStreamerName: "NewStreamer" });
	});

	it("uses 'Someone' as fallback name when participant not found", async () => {
		let emittedData: unknown;
		const io = {
			to: vi.fn(() => ({
				emit: vi.fn((event: string, data: unknown) => {
					if (event === "peerjs:streamer_changed") emittedData = data;
				}),
			})),
		};

		await initiateStreamerTransfer(io as never, "room-1", "unknown-user", []);

		expect(emittedData).toMatchObject({ newStreamerName: "Someone" });
	});
});
