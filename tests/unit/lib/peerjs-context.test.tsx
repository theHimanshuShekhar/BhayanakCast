/**
 * PeerJSContext Unit Tests
 *
 * Tests for PeerJSProvider singleton behavior and usePeerJSContext hook.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { PeerJSProvider, usePeerJSContext } from "../../../src/lib/peerjs-context";

// Hoist mock setup so vi.mock factory can access it
const { mockPeerInstance, MockPeer } = vi.hoisted(() => {
	const mockPeerInstance = {
		id: "test-peer-id",
		destroyed: false,
		destroy: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		reconnect: vi.fn(),
		call: vi.fn(),
	};
	const MockPeer = vi.fn(() => mockPeerInstance);
	return { mockPeerInstance, MockPeer };
});

vi.mock("peerjs", () => ({
	default: MockPeer,
}));

function wrapper({ children }: { children: React.ReactNode }) {
	return <PeerJSProvider>{children}</PeerJSProvider>;
}

describe("PeerJSProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPeerInstance.destroyed = false;
		mockPeerInstance.id = "test-peer-id";
	});

	describe("getOrCreatePeer", () => {
		it("creates a new peer when none exists", () => {
			const { result } = renderHook(() => usePeerJSContext(), { wrapper });

			act(() => {
				result.current.getOrCreatePeer("room-user-123");
			});

			expect(MockPeer).toHaveBeenCalledWith("room-user-123", { debug: 2 });
		});

		it("reuses existing peer if not destroyed", () => {
			const { result } = renderHook(() => usePeerJSContext(), { wrapper });

			let peer1: ReturnType<typeof result.current.getOrCreatePeer>;
			let peer2: ReturnType<typeof result.current.getOrCreatePeer>;

			act(() => {
				peer1 = result.current.getOrCreatePeer("peer-id-1");
				peer2 = result.current.getOrCreatePeer("peer-id-2");
			});

			// Should only create one peer (reuse for second call)
			expect(MockPeer).toHaveBeenCalledTimes(1);
			expect(peer1).toBe(peer2);
		});

		it("creates new peer if existing one is destroyed", () => {
			const { result } = renderHook(() => usePeerJSContext(), { wrapper });

			act(() => {
				result.current.getOrCreatePeer("peer-id-1");
			});

			// Mark as destroyed
			mockPeerInstance.destroyed = true;

			act(() => {
				result.current.getOrCreatePeer("peer-id-2");
			});

			expect(MockPeer).toHaveBeenCalledTimes(2);
		});
	});

	describe("getPeer", () => {
		it("returns null before initialization", () => {
			const { result } = renderHook(() => usePeerJSContext(), { wrapper });

			expect(result.current.getPeer()).toBeNull();
		});

		it("returns peer after initialization", () => {
			const { result } = renderHook(() => usePeerJSContext(), { wrapper });

			act(() => {
				result.current.getOrCreatePeer("test-peer");
			});

			expect(result.current.getPeer()).toBe(mockPeerInstance);
		});
	});

	describe("destroyPeer", () => {
		it("destroys and clears the peer", () => {
			const { result } = renderHook(() => usePeerJSContext(), { wrapper });

			act(() => {
				result.current.getOrCreatePeer("test-peer");
			});

			act(() => {
				result.current.destroyPeer();
			});

			expect(mockPeerInstance.destroy).toHaveBeenCalledTimes(1);
			expect(result.current.getPeer()).toBeNull();
		});

		it("is a no-op when no peer exists", () => {
			const { result } = renderHook(() => usePeerJSContext(), { wrapper });

			expect(() => {
				act(() => {
					result.current.destroyPeer();
				});
			}).not.toThrow();

			expect(mockPeerInstance.destroy).not.toHaveBeenCalled();
		});
	});
});

describe("usePeerJSContext", () => {
	it("throws when used outside PeerJSProvider", () => {
		// Suppress React error output during this test
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(() => {
			renderHook(() => usePeerJSContext());
		}).toThrow("usePeerJSContext must be used within PeerJSProvider");

		consoleSpy.mockRestore();
	});

	it("returns context when inside PeerJSProvider", () => {
		const { result } = renderHook(() => usePeerJSContext(), { wrapper });

		expect(result.current).toHaveProperty("getPeer");
		expect(result.current).toHaveProperty("getOrCreatePeer");
		expect(result.current).toHaveProperty("destroyPeer");
	});
});

describe("PeerJSProvider isolation", () => {
	it("each provider instance has its own peer", () => {
		const mockInstance1 = { ...mockPeerInstance, id: "peer-1" };
		const mockInstance2 = { ...mockPeerInstance, id: "peer-2" };
		let callCount = 0;

		MockPeer.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? mockInstance1 : mockInstance2;
		});

		const { result: result1 } = renderHook(() => usePeerJSContext(), {
			wrapper: ({ children }) => <PeerJSProvider>{children}</PeerJSProvider>,
		});
		const { result: result2 } = renderHook(() => usePeerJSContext(), {
			wrapper: ({ children }) => <PeerJSProvider>{children}</PeerJSProvider>,
		});

		act(() => {
			result1.current.getOrCreatePeer("peer-1");
			result2.current.getOrCreatePeer("peer-2");
		});

		expect(result1.current.getPeer()).toBe(mockInstance1);
		expect(result2.current.getPeer()).toBe(mockInstance2);
	});
});
