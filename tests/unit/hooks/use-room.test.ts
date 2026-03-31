/**
 * useRoom Hook Unit Tests
 *
 * Covers: all WebSocket event handlers, actions (joinRoom/leaveRoom/transferStreamer),
 * derived state (isStreamer), lifecycle (auto-join, room ID change), and error paths.
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

// Retrieve a registered event handler by name
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

describe("useRoom", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ─── streamerPeerId ───────────────────────────────────────────────────────

	describe("streamerPeerId", () => {
		it("includes streamerPeerId in initial roomState from room:joined", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:joined")({
					roomId: "room-1",
					participant: { userId: "user-123", userName: "Test User", joinedAt: new Date(), isStreamer: false },
					roomState: { ...baseRoomState, streamerPeerId: "room-1-streamer-user-1234567890" },
				});
			});

			expect(result.current.roomState?.streamerPeerId).toBe("room-1-streamer-user-1234567890");
		});

		it("includes streamerPeerId in roomState from room:state_sync", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:state_sync")({
					roomId: "room-1",
					roomState: { ...baseRoomState, streamerPeerId: "room-1-streamer-user-9999" },
				});
			});

			expect(result.current.roomState?.streamerPeerId).toBe("room-1-streamer-user-9999");
		});

		it("updates streamerPeerId when room:state_sync fires with new peerId", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:state_sync")({
					roomId: "room-1",
					roomState: { ...baseRoomState, streamerPeerId: null },
				});
			});
			expect(result.current.roomState?.streamerPeerId).toBeNull();

			act(() => {
				getHandler("room:state_sync")({
					roomId: "room-1",
					roomState: { ...baseRoomState, streamerPeerId: "room-1-streamer-ready" },
				});
			});
			expect(result.current.roomState?.streamerPeerId).toBe("room-1-streamer-ready");
		});

		it("preserves streamerPeerId null when not set", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:joined")({
					roomId: "room-1",
					participant: { userId: "user-123", userName: "Test User", joinedAt: new Date(), isStreamer: false },
					roomState: { ...baseRoomState, streamerPeerId: null },
				});
			});

			expect(result.current.roomState?.streamerPeerId).toBeNull();
		});

		it("resets streamerPeerId to null when room:streamer_changed fires", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:state_sync")({
					roomId: "room-1",
					roomState: { ...baseRoomState, streamerPeerId: "old-streamer-peer-id" },
				});
			});
			expect(result.current.roomState?.streamerPeerId).toBe("old-streamer-peer-id");

			act(() => {
				getHandler("room:streamer_changed")({
					newStreamerId: "new-streamer-user",
					newStreamerName: "New Streamer",
				});
			});

			expect(result.current.roomState?.streamerId).toBe("new-streamer-user");
			expect(result.current.roomState?.streamerPeerId).toBeNull();
		});

		it("updates streamerPeerId when room:user_joined brings fresh roomState", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:joined")({
					roomId: "room-1",
					participant: { userId: "user-123", userName: "Me", joinedAt: new Date(), isStreamer: false },
					roomState: { ...baseRoomState, streamerPeerId: null },
				});
			});

			act(() => {
				getHandler("room:user_joined")({
					userId: "other-user",
					userName: "Other",
					participantCount: 2,
					roomState: { ...baseRoomState, streamerPeerId: "room-1-streamer-now-ready" },
				});
			});

			expect(result.current.roomState?.streamerPeerId).toBe("room-1-streamer-now-ready");
		});
	});

	// ─── room:user_left ───────────────────────────────────────────────────────

	describe("room:user_left", () => {
		it("updates roomState when a user leaves", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:joined")({
					roomId: "room-1",
					participant: { userId: "user-123", userName: "Me", joinedAt: new Date(), isStreamer: false },
					roomState: { ...baseRoomState, status: "active" },
				});
			});

			act(() => {
				getHandler("room:user_left")({
					userId: "other-user",
					userName: "Other",
					participantCount: 1,
					roomState: { ...baseRoomState, status: "preparing" },
				});
			});

			expect(result.current.roomState?.status).toBe("preparing");
		});

		it("ignores events for different rooms", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:joined")({
					roomId: "room-1",
					participant: { userId: "user-123", userName: "Me", joinedAt: new Date(), isStreamer: false },
					roomState: { ...baseRoomState, status: "active" },
				});
			});

			act(() => {
				getHandler("room:user_left")({
					userId: "other-user",
					userName: "Other",
					participantCount: 1,
					roomState: { ...baseRoomState, id: "room-2", status: "waiting" },
				});
			});

			// roomState.id still "room-1" because different room was ignored
			expect(result.current.roomState?.id).toBe("room-1");
		});
	});

	// ─── room:status_changed ──────────────────────────────────────────────────

	describe("room:status_changed", () => {
		it("updates status while preserving other roomState fields", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:state_sync")({
					roomId: "room-1",
					roomState: { ...baseRoomState, status: "preparing", name: "My Room" },
				});
			});

			act(() => {
				getHandler("room:status_changed")({ status: "active" });
			});

			expect(result.current.roomState?.status).toBe("active");
			expect(result.current.roomState?.name).toBe("My Room");
		});

		it("handles all valid status transitions", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:state_sync")({ roomId: "room-1", roomState: baseRoomState });
			});

			for (const status of ["waiting", "preparing", "active", "ended"] as const) {
				act(() => { getHandler("room:status_changed")({ status }); });
				expect(result.current.roomState?.status).toBe(status);
			}
		});

		it("does not update if roomState is null", () => {
			const { result } = renderHook(() => useRoom("room-1"));
			// No join — roomState is null
			act(() => { getHandler("room:status_changed")({ status: "active" }); });
			expect(result.current.roomState).toBeNull();
		});
	});

	// ─── room:ended ───────────────────────────────────────────────────────────

	describe("room:ended", () => {
		it("sets status to ended when roomId matches", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:joined")({
					roomId: "room-1",
					participant: { userId: "user-123", userName: "Me", joinedAt: new Date(), isStreamer: false },
					roomState: { ...baseRoomState, status: "active" },
				});
			});

			act(() => { getHandler("room:ended")({ roomId: "room-1" }); });

			expect(result.current.roomState?.status).toBe("ended");
			expect(result.current.isJoined).toBe(false);
		});

		it("ignores room:ended for a different roomId", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:joined")({
					roomId: "room-1",
					participant: { userId: "user-123", userName: "Me", joinedAt: new Date(), isStreamer: false },
					roomState: { ...baseRoomState, status: "active" },
				});
			});

			act(() => { getHandler("room:ended")({ roomId: "room-99" }); });

			expect(result.current.roomState?.status).toBe("active");
			expect(result.current.isJoined).toBe(true);
		});
	});

	// ─── error handling ───────────────────────────────────────────────────────

	describe("error handling", () => {
		it("room:join_error sets error message and clears isLoading", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:join_error")({ message: "Room is full" });
			});

			expect(result.current.error).toBe("Room is full");
			expect(result.current.isLoading).toBe(false);
		});

		it("room:error sets error message", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:error")({ message: "Something went wrong" });
			});

			expect(result.current.error).toBe("Something went wrong");
		});
	});

	// ─── actions ──────────────────────────────────────────────────────────────

	describe("actions", () => {
		it("joinRoom emits room:join with roomId", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => { result.current.joinRoom(); });

			expect(mockSocket.emit).toHaveBeenCalledWith("room:join", { roomId: "room-1" });
		});

		it("joinRoom is a no-op when called a second time (already joined)", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => { result.current.joinRoom(); });
			act(() => { result.current.joinRoom(); });

			// Only one room:join emit despite two calls
			const joinCalls = mockSocket.emit.mock.calls.filter(([e]) => e === "room:join");
			expect(joinCalls).toHaveLength(1);
		});

		it("leaveRoom emits room:leave and resets isJoined", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:joined")({
					roomId: "room-1",
					participant: { userId: "user-123", userName: "Me", joinedAt: new Date(), isStreamer: false },
					roomState: baseRoomState,
				});
			});
			expect(result.current.isJoined).toBe(true);

			act(() => { result.current.leaveRoom(); });

			expect(mockSocket.emit).toHaveBeenCalledWith("room:leave", { roomId: "room-1" });
			expect(result.current.isJoined).toBe(false);
		});

		it("transferStreamer emits streamer:transfer with correct payload", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => { result.current.transferStreamer("user-456"); });

			expect(mockSocket.emit).toHaveBeenCalledWith("streamer:transfer", {
				roomId: "room-1",
				newStreamerId: "user-456",
			});
		});
	});

	// ─── isStreamer derived state ─────────────────────────────────────────────

	describe("isStreamer", () => {
		it("is true when userId matches streamerId", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:state_sync")({
					roomId: "room-1",
					// userId from mock is "user-123"
					roomState: { ...baseRoomState, streamerId: "user-123" },
				});
			});

			expect(result.current.isStreamer).toBe(true);
		});

		it("is false when userId differs from streamerId", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:state_sync")({
					roomId: "room-1",
					roomState: { ...baseRoomState, streamerId: "someone-else" },
				});
			});

			expect(result.current.isStreamer).toBe(false);
		});

		it("is false when roomState is null", () => {
			const { result } = renderHook(() => useRoom("room-1"));
			expect(result.current.isStreamer).toBe(false);
		});
	});

	// ─── early-return guard branches ─────────────────────────────────────────

	describe("early-return guards", () => {
		it("room:joined ignores event when roomId does not match", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:joined")({
					roomId: "room-99",
					participant: { userId: "user-123", userName: "Me", joinedAt: new Date(), isStreamer: false },
					roomState: { ...baseRoomState, id: "room-99", name: "Other Room" },
				});
			});

			expect(result.current.roomState).toBeNull();
			expect(result.current.isJoined).toBe(false);
		});

		it("room:state_sync ignores event when roomId does not match", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			act(() => {
				getHandler("room:state_sync")({
					roomId: "room-99",
					roomState: { ...baseRoomState, id: "room-99" },
				});
			});

			expect(result.current.roomState).toBeNull();
		});

		it("room:user_joined ignores event when roomState.id does not match", () => {
			const { result } = renderHook(() => useRoom("room-1"));

			// First join room-1
			act(() => {
				getHandler("room:joined")({
					roomId: "room-1",
					participant: { userId: "user-123", userName: "Me", joinedAt: new Date(), isStreamer: false },
					roomState: { ...baseRoomState, status: "active" },
				});
			});

			act(() => {
				getHandler("room:user_joined")({
					userId: "other",
					userName: "Other",
					participantCount: 2,
					roomState: { ...baseRoomState, id: "room-99", status: "ended" },
				});
			});

			// roomState should still be room-1 state (unchanged)
			expect(result.current.roomState?.id).toBe("room-1");
			expect(result.current.roomState?.status).toBe("active");
		});

		it("transferStreamer is a no-op when roomId is undefined", () => {
			const { result } = renderHook(() => useRoom(undefined));

			act(() => {
				result.current.transferStreamer("new-streamer");
			});

			const transferCalls = mockSocket.emit.mock.calls.filter(([e]) => e === "streamer:transfer");
			expect(transferCalls).toHaveLength(0);
		});
	});

	// ─── null roomState edge cases ───────────────────────────────────────────

	describe("null roomState edge cases", () => {
		it("room:streamer_changed returns null roomState when prev is null", () => {
			const { result } = renderHook(() => useRoom("room-1"));
			// Don't join — roomState stays null
			act(() => {
				getHandler("room:streamer_changed")({
					newStreamerId: "s-1",
					newStreamerName: "Alice",
				});
			});
			expect(result.current.roomState).toBeNull();
		});

		it("room:ended keeps null roomState when no join has occurred", () => {
			const { result } = renderHook(() => useRoom("room-1"));
			// Don't join — fire ended with matching roomId
			act(() => {
				getHandler("room:ended")({ roomId: "room-1" });
			});
			expect(result.current.roomState).toBeNull();
		});

		it("sets isLoading to false immediately when roomId is undefined", () => {
			const { result } = renderHook(() => useRoom(undefined));
			expect(result.current.isLoading).toBe(false);
		});

		it("joinRoom sets error when roomId is undefined", () => {
			const { result } = renderHook(() => useRoom(undefined));
			act(() => {
				result.current.joinRoom();
			});
			expect(result.current.error).toBe(
				"Cannot join room - missing required data",
			);
		});
	});

	// ─── auto-join on mount ───────────────────────────────────────────────────

	describe("auto-join on mount", () => {
		it("emits room:join automatically when socket and roomId are available", () => {
			renderHook(() => useRoom("room-1"));
			expect(mockSocket.emit).toHaveBeenCalledWith("room:join", { roomId: "room-1" });
		});
	});

	// ─── event listener cleanup ───────────────────────────────────────────────

	describe("cleanup", () => {
		it("deregisters all event listeners on unmount", () => {
			const { unmount } = renderHook(() => useRoom("room-1"));
			unmount();

			const offEvents = mockSocket.off.mock.calls.map(([name]) => name);
			expect(offEvents).toContain("room:joined");
			expect(offEvents).toContain("room:state_sync");
			expect(offEvents).toContain("room:user_joined");
			expect(offEvents).toContain("room:user_left");
			expect(offEvents).toContain("room:streamer_changed");
			expect(offEvents).toContain("room:status_changed");
			expect(offEvents).toContain("room:ended");
			expect(offEvents).toContain("room:join_error");
			expect(offEvents).toContain("room:error");
		});
	});
});
