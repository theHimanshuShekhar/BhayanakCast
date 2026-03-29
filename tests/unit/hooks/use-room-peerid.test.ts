/**
 * useRoom streamerPeerId Unit Tests
 *
 * Tests that streamerPeerId is properly included in RoomState
 * and updated when the streamer becomes ready.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRoom } from "../../../src/hooks/useRoom";
import type { RoomState } from "../../../src/hooks/useRoom";

// Mock WebSocket context
const mockSocket = {
	emit: vi.fn(),
	on: vi.fn(),
	off: vi.fn(),
};

vi.mock("../../../src/lib/websocket-context", () => ({
	useWebSocket: () => ({
		socket: mockSocket,
		userId: "user-123",
		isConnected: true,
		setCurrentRoomId: vi.fn(),
	}),
}));

// Capture registered event handlers
function getHandler(eventName: string): (data: unknown) => void {
	const calls = mockSocket.on.mock.calls;
	const call = calls.find(([name]) => name === eventName);
	if (!call) throw new Error(`No handler registered for "${eventName}"`);
	return call[1];
}

const baseRoomState: RoomState = {
	id: "room-1",
	name: "Test Room",
	status: "active",
	streamerId: "streamer-user",
	streamerPeerId: null,
	participants: [],
	createdAt: new Date(),
};

describe("useRoom - streamerPeerId", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("includes streamerPeerId in initial roomState from room:joined", () => {
		const { result } = renderHook(() => useRoom("room-1"));

		const handleJoined = getHandler("room:joined");
		act(() => {
			handleJoined({
				roomId: "room-1",
				participant: {
					userId: "user-123",
					userName: "Test User",
					joinedAt: new Date(),
					isStreamer: false,
				},
				roomState: {
					...baseRoomState,
					streamerPeerId: "room-1-streamer-user-1234567890",
				},
			});
		});

		expect(result.current.roomState?.streamerPeerId).toBe(
			"room-1-streamer-user-1234567890",
		);
	});

	it("includes streamerPeerId in roomState from room:state_sync", () => {
		const { result } = renderHook(() => useRoom("room-1"));

		const handleStateSync = getHandler("room:state_sync");
		act(() => {
			handleStateSync({
				roomId: "room-1",
				roomState: {
					...baseRoomState,
					streamerPeerId: "room-1-streamer-user-9999",
				},
			});
		});

		expect(result.current.roomState?.streamerPeerId).toBe(
			"room-1-streamer-user-9999",
		);
	});

	it("updates streamerPeerId when room:state_sync fires with new peerId", () => {
		const { result } = renderHook(() => useRoom("room-1"));

		const handleStateSync = getHandler("room:state_sync");

		// First sync without peerId
		act(() => {
			handleStateSync({
				roomId: "room-1",
				roomState: { ...baseRoomState, streamerPeerId: null },
			});
		});
		expect(result.current.roomState?.streamerPeerId).toBeNull();

		// Second sync with peerId (streamer became ready)
		act(() => {
			handleStateSync({
				roomId: "room-1",
				roomState: {
					...baseRoomState,
					streamerPeerId: "room-1-streamer-ready",
				},
			});
		});
		expect(result.current.roomState?.streamerPeerId).toBe(
			"room-1-streamer-ready",
		);
	});

	it("preserves streamerPeerId null when not set", () => {
		const { result } = renderHook(() => useRoom("room-1"));

		const handleJoined = getHandler("room:joined");
		act(() => {
			handleJoined({
				roomId: "room-1",
				participant: {
					userId: "user-123",
					userName: "Test User",
					joinedAt: new Date(),
					isStreamer: false,
				},
				roomState: { ...baseRoomState, streamerPeerId: null },
			});
		});

		expect(result.current.roomState?.streamerPeerId).toBeNull();
	});

	it("resets streamerPeerId to null when room:streamer_changed fires", () => {
		const { result } = renderHook(() => useRoom("room-1"));

		// First, set initial state with a streamerPeerId
		const handleStateSync = getHandler("room:state_sync");
		act(() => {
			handleStateSync({
				roomId: "room-1",
				roomState: { ...baseRoomState, streamerPeerId: "old-streamer-peer-id" },
			});
		});
		expect(result.current.roomState?.streamerPeerId).toBe("old-streamer-peer-id");

		// Streamer changes — streamerPeerId must be reset to null
		const handleStreamerChanged = getHandler("room:streamer_changed");
		act(() => {
			handleStreamerChanged({
				newStreamerId: "new-streamer-user",
				newStreamerName: "New Streamer",
			});
		});

		expect(result.current.roomState?.streamerId).toBe("new-streamer-user");
		expect(result.current.roomState?.streamerPeerId).toBeNull();
	});

	it("updates streamerPeerId when user_joined brings fresh roomState", () => {
		const { result } = renderHook(() => useRoom("room-1"));

		// First join ourselves
		const handleJoined = getHandler("room:joined");
		act(() => {
			handleJoined({
				roomId: "room-1",
				participant: { userId: "user-123", userName: "Me", joinedAt: new Date(), isStreamer: false },
				roomState: { ...baseRoomState, streamerPeerId: null },
			});
		});

		// Another user joins, room state now includes streamerPeerId
		const handleUserJoined = getHandler("room:user_joined");
		act(() => {
			handleUserJoined({
				userId: "other-user",
				userName: "Other",
				participantCount: 2,
				roomState: {
					...baseRoomState,
					streamerPeerId: "room-1-streamer-now-ready",
				},
			});
		});

		expect(result.current.roomState?.streamerPeerId).toBe(
			"room-1-streamer-now-ready",
		);
	});
});
