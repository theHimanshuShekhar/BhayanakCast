/**
 * WebSocketContext Unit Tests
 *
 * Covers: anonymous user ID generation, provider initial state,
 * socket connect/disconnect, userCount debouncing, auto-rejoin, and
 * the useWebSocket guard (throws outside provider).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { WebSocketProvider, useWebSocket } from "../../../src/lib/websocket-context";

// ─── Mock socket.io-client ────────────────────────────────────────────────────

// Capture handlers so tests can trigger events manually
const socketHandlers: Record<string, Array<(data?: unknown) => void>> = {};

const mockSocket = {
	on: vi.fn((event: string, handler: (data?: unknown) => void) => {
		if (!socketHandlers[event]) socketHandlers[event] = [];
		socketHandlers[event].push(handler);
	}),
	off: vi.fn(),
	emit: vi.fn(),
	disconnect: vi.fn(),
	connected: false,
};

vi.mock("socket.io-client", () => ({
	io: vi.fn(() => mockSocket),
}));

// ─── Mock auth client ─────────────────────────────────────────────────────────

vi.mock("../../../src/lib/auth-client", () => ({
	authClient: {
		useSession: vi.fn(() => ({ data: null })),
	},
}));

// ─── Mock runtime config ──────────────────────────────────────────────────────

vi.mock("../../../src/utils/runtime-config", () => ({
	getRuntimeConfig: vi.fn().mockResolvedValue({ wsUrl: "http://localhost:3001" }),
}));

// ─── Test wrapper ─────────────────────────────────────────────────────────────

function makeWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
	});

	function Wrapper({ children }: { children: React.ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>
				<WebSocketProvider>{children}</WebSocketProvider>
			</QueryClientProvider>
		);
	}
	return Wrapper;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function triggerSocketEvent(event: string, data?: unknown) {
	for (const handler of socketHandlers[event] ?? []) {
		handler(data);
	}
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useWebSocket", () => {
	it("throws when used outside WebSocketProvider", () => {
		// Suppress React's expected console.error for this test
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => renderHook(() => useWebSocket())).toThrow(
			"useWebSocket must be used within a WebSocketProvider",
		);
		spy.mockRestore();
	});
});

describe("WebSocketProvider", () => {
	beforeEach(() => {
		// Clear captured handlers between tests
		for (const key of Object.keys(socketHandlers)) {
			delete socketHandlers[key];
		}
		vi.clearAllMocks();
		// Default: getItem returns null (no stored anonymous ID)
		vi.mocked(window.localStorage.getItem).mockReturnValue(null);
	});

	it("provides initial disconnected state", async () => {
		const { result } = renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		await waitFor(() => {
			expect(result.current.isConnected).toBe(false);
		});
		expect(result.current.userCount).toBe(0);
		expect(result.current.currentRoomId).toBeNull();
	});

	it("sets isConnected to true when socket connects", async () => {
		const { result } = renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		act(() => { triggerSocketEvent("connect"); });

		await waitFor(() => {
			expect(result.current.isConnected).toBe(true);
		});
	});

	it("sets isConnected to false when socket disconnects", async () => {
		const { result } = renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		act(() => { triggerSocketEvent("connect"); });
		await waitFor(() => expect(result.current.isConnected).toBe(true));

		act(() => { triggerSocketEvent("disconnect"); });
		await waitFor(() => expect(result.current.isConnected).toBe(false));
	});

	it("emits identify on connect with a userId", async () => {
		renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		act(() => { triggerSocketEvent("connect"); });

		await waitFor(() => {
			const identifyCalls = mockSocket.emit.mock.calls.filter(([e]) => e === "identify");
			expect(identifyCalls.length).toBeGreaterThan(0);
			const [, payload] = identifyCalls[0];
			expect(payload).toHaveProperty("userId");
			expect(typeof payload.userId).toBe("string");
			expect(payload.userId.length).toBeGreaterThan(0);
		});
	});

	it("generates an anonymous user ID and calls localStorage.setItem", async () => {
		const { result } = renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		act(() => { triggerSocketEvent("connect"); });

		await waitFor(() => expect(result.current.isConnected).toBe(true));

		// Anonymous ID should be stored in localStorage
		expect(window.localStorage.setItem).toHaveBeenCalledWith(
			"bhayanak_anonymous_user_id",
			expect.stringMatching(/^anon_/),
		);

		// The hook's userId should be an anon_ prefixed string
		expect(result.current.userId).toMatch(/^anon_/);
	});

	it("reuses existing anonymous ID from localStorage", async () => {
		const existingId = "anon_existing-id-12345";
		// Configure mock to return the existing ID when the key is queried
		vi.mocked(window.localStorage.getItem).mockReturnValueOnce(existingId);

		const { result } = renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		act(() => { triggerSocketEvent("connect"); });

		await waitFor(() => expect(result.current.isConnected).toBe(true));
		expect(result.current.userId).toBe(existingId);
	});

	it("updates userCount when userCount event fires", async () => {
		vi.useFakeTimers();
		try {
			const { result } = renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

			act(() => { triggerSocketEvent("userCount", { count: 42 }); });
			// Advance past the 300ms debounce
			act(() => { vi.advanceTimersByTime(400); });

			expect(result.current.userCount).toBe(42);
		} finally {
			vi.useRealTimers();
		}
	});

	it("debounces rapid userCount updates (only last value applied)", async () => {
		vi.useFakeTimers();
		try {
			const { result } = renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

			// Fire multiple rapid updates
			act(() => {
				triggerSocketEvent("userCount", { count: 10 });
				triggerSocketEvent("userCount", { count: 20 });
				triggerSocketEvent("userCount", { count: 30 });
			});

			// Before debounce resolves, count should still be 0
			expect(result.current.userCount).toBe(0);

			act(() => { vi.advanceTimersByTime(400); });

			expect(result.current.userCount).toBe(30);
		} finally {
			vi.useRealTimers();
		}
	});

	it("emits room:rejoin on reconnect when in a room", async () => {
		const { result } = renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		// Simulate joining a room
		act(() => { result.current.setCurrentRoomId("room-abc"); });

		// Connect (and trigger auto-rejoin logic)
		act(() => { triggerSocketEvent("connect"); });

		await waitFor(() => {
			const rejoinCalls = mockSocket.emit.mock.calls.filter(([e]) => e === "room:rejoin");
			expect(rejoinCalls.length).toBeGreaterThan(0);
			expect(rejoinCalls[0][1]).toMatchObject({ roomId: "room-abc" });
		});
	});

	it("does not emit room:rejoin on connect when not in a room", async () => {
		renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		act(() => { triggerSocketEvent("connect"); });

		await waitFor(() => expect(mockSocket.emit).toHaveBeenCalled());

		const rejoinCalls = mockSocket.emit.mock.calls.filter(([e]) => e === "room:rejoin");
		expect(rejoinCalls).toHaveLength(0);
	});

	it("sendMessage emits to socket when connected", async () => {
		mockSocket.connected = true;
		const { result } = renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		act(() => { result.current.sendMessage({ type: "ping" }); });

		expect(mockSocket.emit).toHaveBeenCalledWith("message", { type: "ping" });
		mockSocket.connected = false;
	});

	it("setCurrentRoomId updates currentRoomId", async () => {
		const { result } = renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		act(() => { result.current.setCurrentRoomId("room-xyz"); });

		expect(result.current.currentRoomId).toBe("room-xyz");

		act(() => { result.current.setCurrentRoomId(null); });

		expect(result.current.currentRoomId).toBeNull();
	});

	it("re-identify effect emits identify when socket is already connected on mount", async () => {
		// Set socket as connected before provider mounts so the re-identify effect
		// runs the true branch (socket?.connected = true) immediately on mount
		mockSocket.connected = true;

		renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		await waitFor(() => {
			const identifyCalls = mockSocket.emit.mock.calls.filter(([e]) => e === "identify");
			expect(identifyCalls.length).toBeGreaterThan(0);
		});

		// Restore for other tests
		mockSocket.connected = false;
	});

	it("re-identify uses userId fallback when session has no name", async () => {
		const { authClient: ac } = await import("../../../src/lib/auth-client");
		vi.mocked(ac.useSession).mockReturnValue({
			data: { user: { id: "session-user-99", name: "", image: null } } as Parameters<typeof ac.useSession>[0],
		} as ReturnType<typeof ac.useSession>);

		mockSocket.connected = true;

		renderHook(() => useWebSocket(), { wrapper: makeWrapper() });

		await waitFor(() => {
			const identifyCalls = mockSocket.emit.mock.calls.filter(([e]) => e === "identify");
			expect(identifyCalls.length).toBeGreaterThan(0);
			// userName should fall back to userId when name is empty
			const payload = identifyCalls[0][1] as { userId: string; userName: string };
			// userName === userId when name is falsy (the || userId fallback)
			expect(payload.userName).toBe(payload.userId);
		});

		mockSocket.connected = false;
		vi.mocked(ac.useSession).mockReturnValue({ data: null } as ReturnType<typeof ac.useSession>);
	});
});
