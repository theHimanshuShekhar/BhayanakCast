/**
 * StreamingContext Unit Tests
 *
 * Covers: initial state, useStreaming guard, useStreamingOptional,
 * stopScreenShare socket emit, duplicate-emit guard, deviceCapabilities,
 * socket event handlers, peer initialization, viewer connection flow,
 * and startScreenShare error paths.
 *
 * Note: startScreenShare success path is not fully tested here because it
 * requires navigator.mediaDevices.getDisplayMedia which jsdom does not implement.
 * It is covered by E2E tests in e2e/tests/webrtc/screen-sharing.spec.ts.
 */

if (typeof MediaStream === "undefined") {
	(globalThis as Record<string, unknown>).MediaStream = class {
		getTracks() {
			return [];
		}
		getAudioTracks() {
			return [];
		}
		getVideoTracks() {
			return [];
		}
	};
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { detectDevice } from "../../../src/lib/device-detection";
import {
	StreamingProvider,
	useStreaming,
	useStreamingOptional,
} from "../../../src/lib/streaming-context";

// ─── Mutable handler capture dicts + mock objects (all in vi.hoisted) ─────────

const {
	socketHandlers,
	peerHandlers,
	callHandlers,
	mockSocket,
	mockPeerInstance,
	MockPeer,
	mockDestroyPeer,
	mockGetOrCreatePeer,
} = vi.hoisted(() => {
	const socketHandlers: Record<string, (...args: unknown[]) => void> = {};
	const peerHandlers: Record<string, (...args: unknown[]) => void> = {};
	const callHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

	const mockCall = {
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			if (!callHandlers[event]) callHandlers[event] = [];
			callHandlers[event].push(handler);
		}),
		once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			const key = `once_${event}`;
			if (!callHandlers[key]) callHandlers[key] = [];
			callHandlers[key].push(handler);
		}),
		close: vi.fn(),
	};

	const mockPeerInstance = {
		id: "test-peer-id",
		destroyed: false,
		destroy: vi.fn(),
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			peerHandlers[event] = handler;
		}),
		once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			peerHandlers[`once_${event}`] = handler;
		}),
		call: vi.fn(() => mockCall),
		reconnect: vi.fn(),
	};

	const MockPeer = vi.fn(() => mockPeerInstance);

	const mockSocket = {
		emit: vi.fn(),
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			socketHandlers[event] = handler;
		}),
		off: vi.fn(),
	};

	const mockDestroyPeer = vi.fn();
	const mockGetOrCreatePeer = vi.fn(() => mockPeerInstance);

	return {
		socketHandlers,
		peerHandlers,
		callHandlers,
		mockSocket,
		mockPeerInstance,
		MockPeer,
		mockDestroyPeer,
		mockGetOrCreatePeer,
	};
});

vi.mock("peerjs", () => ({ default: MockPeer }));

vi.mock("../../../src/lib/websocket-context", () => ({
	useWebSocket: () => ({
		socket: mockSocket,
		userId: "user-1",
		isConnected: true,
		setCurrentRoomId: vi.fn(),
	}),
}));

vi.mock("../../../src/lib/peerjs-context", () => ({
	usePeerJSContext: () => ({
		getOrCreatePeer: mockGetOrCreatePeer,
		destroyPeer: mockDestroyPeer,
		getPeer: vi.fn(() => null),
	}),
}));

vi.mock("../../../src/lib/device-detection", () => ({
	detectDevice: vi.fn(() => ({
		isMobile: false,
		canStream: true,
		canView: true,
		deviceType: "desktop",
		userAgent: "test-agent",
	})),
}));

// ─── Provider wrapper ─────────────────────────────────────────────────────────

function makeWrapper(
	roomId = "room-1",
	userId = "user-1",
	streamerPeerId: string | null = null,
) {
	function Wrapper({ children }: { children: React.ReactNode }) {
		return (
			<StreamingProvider
				roomId={roomId}
				userId={userId}
				streamerPeerId={streamerPeerId}
			>
				{children}
			</StreamingProvider>
		);
	}
	return Wrapper;
}

function clearHandlerDicts() {
	for (const k of Object.keys(peerHandlers)) delete peerHandlers[k];
	for (const k of Object.keys(callHandlers)) delete callHandlers[k];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useStreaming", () => {
	it("throws when used outside StreamingProvider", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => renderHook(() => useStreaming())).toThrow(
			"useStreaming must be used within StreamingProvider",
		);
		spy.mockRestore();
	});
});

describe("useStreamingOptional", () => {
	it("returns null when used outside StreamingProvider", () => {
		const { result } = renderHook(() => useStreamingOptional());
		expect(result.current).toBeNull();
	});

	it("returns the context when used inside StreamingProvider", () => {
		const { result } = renderHook(() => useStreamingOptional(), {
			wrapper: makeWrapper(),
		});
		expect(result.current).not.toBeNull();
	});
});

describe("StreamingProvider — initial state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearHandlerDicts();
	});

	it("localStream is null initially", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.localStream).toBeNull();
	});

	it("remoteStream is null initially", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.remoteStream).toBeNull();
	});

	it("isScreenSharing is false initially", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.isScreenSharing).toBe(false);
	});

	it("connectionStatus is 'idle' initially", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.connectionStatus).toBe("idle");
	});

	it("isStreamer is false initially", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.isStreamer).toBe(false);
	});

	it("isAudioEnabled is true initially", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.isAudioEnabled).toBe(true);
	});

	it("audioConfig defaults to system-and-mic", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.audioConfig).toBe("system-and-mic");
	});

	it("peerId is null initially", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.peerId).toBeNull();
	});

	it("retryAttempt is 0 initially", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.retryAttempt).toBe(0);
	});

	it("lastError is undefined initially", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.lastError).toBeUndefined();
	});

	it("deviceCapabilities reflects detectDevice() output", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(result.current.deviceCapabilities).toMatchObject({
			isMobile: false,
			canStream: true,
			canView: true,
			deviceType: "desktop",
		});
	});
});

describe("StreamingProvider — stopScreenShare", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearHandlerDicts();
	});

	it("emits peerjs:screen_share_ended on the socket", () => {
		const { result } = renderHook(() => useStreaming(), {
			wrapper: makeWrapper("room-abc"),
		});

		act(() => {
			result.current.stopScreenShare();
		});

		expect(mockSocket.emit).toHaveBeenCalledWith("peerjs:screen_share_ended", {
			roomId: "room-abc",
		});
	});

	it("only emits peerjs:screen_share_ended once even if called multiple times", () => {
		const { result } = renderHook(() => useStreaming(), {
			wrapper: makeWrapper("room-abc"),
		});

		act(() => {
			result.current.stopScreenShare();
			result.current.stopScreenShare();
		});

		const calls = mockSocket.emit.mock.calls.filter(
			([event]) => event === "peerjs:screen_share_ended",
		);
		expect(calls).toHaveLength(1);
	});

	it("calls destroyPeer on cleanup", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		act(() => {
			result.current.stopScreenShare();
		});

		expect(mockDestroyPeer).toHaveBeenCalled();
	});
});

describe("StreamingProvider — toggleAudio", () => {
	it("is a no-op when there is no local stream", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(() =>
			act(() => {
				result.current.toggleAudio();
			}),
		).not.toThrow();
		expect(result.current.isAudioEnabled).toBe(true);
	});
});

describe("StreamingProvider — socket event handlers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearHandlerDicts();
	});

	it("registers peerjs:streamer_ready, peerjs:streamer_changed, peerjs:screen_share_ended listeners", () => {
		renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		expect(mockSocket.on).toHaveBeenCalledWith(
			"peerjs:streamer_ready",
			expect.any(Function),
		);
		expect(mockSocket.on).toHaveBeenCalledWith(
			"peerjs:streamer_changed",
			expect.any(Function),
		);
		expect(mockSocket.on).toHaveBeenCalledWith(
			"peerjs:screen_share_ended",
			expect.any(Function),
		);
	});

	it("removes all three socket listeners on unmount", () => {
		const { unmount } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		unmount();
		expect(mockSocket.off).toHaveBeenCalledWith(
			"peerjs:streamer_ready",
			expect.any(Function),
		);
		expect(mockSocket.off).toHaveBeenCalledWith(
			"peerjs:streamer_changed",
			expect.any(Function),
		);
		expect(mockSocket.off).toHaveBeenCalledWith(
			"peerjs:screen_share_ended",
			expect.any(Function),
		);
	});

	it("peerjs:screen_share_ended resets remoteStream to null", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		act(() => {
			socketHandlers["peerjs:screen_share_ended"]?.();
		});
		expect(result.current.remoteStream).toBeNull();
	});

	it("peerjs:screen_share_ended resets connectionStatus to idle", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		act(() => {
			socketHandlers["peerjs:screen_share_ended"]?.();
		});
		expect(result.current.connectionStatus).toBe("idle");
	});

	it("peerjs:streamer_changed with null newStreamerPeerId clears remoteStream", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		act(() => {
			socketHandlers["peerjs:streamer_changed"]?.({
				newStreamerPeerId: null,
				newStreamerName: "Alice",
			});
		});
		expect(result.current.remoteStream).toBeNull();
	});

	it("peerjs:streamer_ready updates audioConfig to the received value", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});
		expect(result.current.audioConfig).toBe("no-audio");
	});
});

describe("StreamingProvider — viewer connection flow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		clearHandlerDicts();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("peerjs:streamer_ready triggers peer creation and sets connectionStatus to connecting", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});

		expect(result.current.connectionStatus).toBe("connecting");
		expect(mockGetOrCreatePeer).toHaveBeenCalled();
		expect(mockPeerInstance.on).toHaveBeenCalledWith("open", expect.any(Function));
	});

	it("peer 'open' event sets peerId in state", async () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});

		await act(async () => {
			peerHandlers["open"]?.("opened-peer-id");
		});

		expect(result.current.peerId).toBe("opened-peer-id");
	});

	it("peer 'open' does NOT emit peerjs:ready when viewer (not streamer)", async () => {
		renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});

		await act(async () => {
			peerHandlers["open"]?.("opened-peer-id");
		});

		expect(mockSocket.emit).not.toHaveBeenCalledWith(
			"peerjs:ready",
			expect.anything(),
		);
	});

	it("after peer opens, call() is made to the streamer peer ID", async () => {
		renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});

		await act(async () => {
			peerHandlers["open"]?.("test-peer-id");
		});

		expect(mockPeerInstance.call).toHaveBeenCalledWith(
			"remote-peer",
			expect.any(Object),
			expect.any(Object),
		);
	});

	it("stream received from call sets remoteStream and connectionStatus to connected", async () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});

		await act(async () => {
			peerHandlers["open"]?.("test-peer-id");
		});

		const testStream = new MediaStream();
		await act(async () => {
			(callHandlers["stream"] || []).forEach((h) => h(testStream));
			(callHandlers["once_stream"] || []).forEach((h) => h(testStream));
		});

		expect(result.current.connectionStatus).toBe("connected");
		expect(result.current.remoteStream).not.toBeNull();
	});

	it("late joiner: streamerPeerId prop auto-initiates connection on mount", () => {
		const { result } = renderHook(() => useStreaming(), {
			wrapper: makeWrapper("room-1", "user-1", "existing-streamer-peer"),
		});

		expect(result.current.connectionStatus).toBe("connecting");
		expect(mockGetOrCreatePeer).toHaveBeenCalled();
	});

	it("peerjs:streamer_changed with new peerId initiates a new connection", () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		act(() => {
			socketHandlers["peerjs:streamer_changed"]?.({
				newStreamerPeerId: "new-streamer-peer",
				newStreamerName: "Bob",
			});
		});

		expect(result.current.connectionStatus).toBe("connecting");
		expect(mockGetOrCreatePeer).toHaveBeenCalled();
	});

	it("peer 'error' event sets lastError with 'Connection failed:' prefix", async () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});

		// Peer error rejects initPeerAsync and connectToStreamer catches it
		await act(async () => {
			peerHandlers["error"]?.(new Error("PeerJS connection failed"));
		});

		expect(result.current.lastError).toBe(
			"Connection failed: PeerJS connection failed",
		);
		expect(result.current.connectionStatus).toBe("failed");
	});

	it("peer 'disconnected' event calls peer.reconnect() when peer is not destroyed", () => {
		renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});

		act(() => {
			peerHandlers["disconnected"]?.();
		});

		expect(mockPeerInstance.reconnect).toHaveBeenCalled();
	});

	it("peer 'call' event closes the call when viewer is not streaming", () => {
		renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});

		const mockIncomingCall = {
			answer: vi.fn(),
			on: vi.fn(),
			close: vi.fn(),
			peer: "caller-peer",
		};

		act(() => {
			peerHandlers["call"]?.(mockIncomingCall);
		});

		// Viewer (not streaming) must reject incoming calls
		expect(mockIncomingCall.close).toHaveBeenCalled();
		expect(mockIncomingCall.answer).not.toHaveBeenCalled();
	});

	it("peerjs:screen_share_ended closes currentCallRef when there is an active call", async () => {
		renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		// Start viewer connection so currentCallRef.current is set
		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});
		await act(async () => { peerHandlers["open"]?.("viewer-peer-id"); });

		// Now currentCallRef.current = mockCall (the return value of peerRef.current.call())
		// Fire screen_share_ended — should close the active call
		act(() => {
			socketHandlers["peerjs:screen_share_ended"]?.();
		});

		// The call returned by mockPeerInstance.call should have been closed
		const activeCall = mockPeerInstance.call.mock.results[0]?.value as { close: ReturnType<typeof vi.fn> };
		expect(activeCall?.close).toHaveBeenCalled();
	});

	it("peerjs:streamer_changed closes currentCallRef when there is an active call", async () => {
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		// Start viewer connection
		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "remote-peer",
				streamerName: "Alice",
				audioConfig: "no-audio",
			});
		});
		await act(async () => { peerHandlers["open"]?.("viewer-peer-id"); });

		// Streamer changes — should close active call and reconnect
		act(() => {
			socketHandlers["peerjs:streamer_changed"]?.({
				newStreamerPeerId: "new-streamer-peer",
				newStreamerName: "Bob",
			});
		});

		const activeCall = mockPeerInstance.call.mock.results[0]?.value as { close: ReturnType<typeof vi.fn> };
		expect(activeCall?.close).toHaveBeenCalled();
		expect(result.current.remoteStream).toBeNull();
	});
});

// Helper: start screen sharing and let getDisplayMedia resolve,
// then trigger peer "open" so startScreenShare completes.
async function performStartScreenShare(
	result: { current: ReturnType<typeof useStreaming> },
	opts: {
		roomId?: string;
		mockDisplayStream: object;
		mockUserMediaStream?: object;
		audioConfig?: "no-audio" | "system-and-mic" | "system-only";
	},
) {
	const audioConfig = opts.audioConfig ?? "no-audio";
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: {
			getDisplayMedia: vi.fn().mockResolvedValue(opts.mockDisplayStream),
			getUserMedia: opts.mockUserMediaStream
				? vi.fn().mockResolvedValue(opts.mockUserMediaStream)
				: vi.fn().mockRejectedValue(new Error("n/a")),
		},
	});

	// Start share — let getDisplayMedia microtask resolve before continuing
	await act(async () => {
		void result.current.startScreenShare({
			audioConfig,
			cursor: "always",
			displaySurface: "default",
		});
		// Yield ONE microtask so getDisplayMedia resolves inside act()
		await Promise.resolve();
	});

	// By now initPeerAsync has registered peer.on("open", ...) — fire it
	await act(async () => {
		peerHandlers["open"]?.("streamer-peer-id");
	});
}

describe("StreamingProvider — startScreenShare success path", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearHandlerDicts();
	});

	it("sets isStreamer, isScreenSharing, connectionStatus=connected after peer opens", async () => {
		const mockStream = {
			getTracks: () => [],
			getVideoTracks: () => [],
			getAudioTracks: () => [],
			addTrack: vi.fn(),
			removeTrack: vi.fn(),
		};
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper("room-1") });

		await performStartScreenShare(result, { mockDisplayStream: mockStream });

		expect(result.current.isStreamer).toBe(true);
		expect(result.current.isScreenSharing).toBe(true);
		expect(result.current.connectionStatus).toBe("connected");
		expect(result.current.peerId).toBe("streamer-peer-id");
	});

	it("peer 'open' emits peerjs:ready and peerjs:streamer_ready when isStreamer is true", async () => {
		const mockStream = {
			getTracks: () => [],
			getVideoTracks: () => [],
			getAudioTracks: () => [],
			addTrack: vi.fn(),
			removeTrack: vi.fn(),
		};
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper("room-1") });

		await performStartScreenShare(result, { mockDisplayStream: mockStream });

		expect(mockSocket.emit).toHaveBeenCalledWith("peerjs:ready", {
			roomId: "room-1",
			peerId: "streamer-peer-id",
		});
		expect(mockSocket.emit).toHaveBeenCalledWith("peerjs:streamer_ready", {
			roomId: "room-1",
			peerId: "streamer-peer-id",
			audioConfig: "no-audio",
		});
	});

	it("incoming 'call' is answered with localStream when isStreamer is true", async () => {
		const mockVideoTrack = { stop: vi.fn(), onended: null as ((() => void) | null), applyConstraints: vi.fn().mockResolvedValue(undefined) };
		const mockStream = {
			getTracks: () => [mockVideoTrack],
			getVideoTracks: () => [mockVideoTrack],
			getAudioTracks: () => [],
			addTrack: vi.fn(),
			removeTrack: vi.fn(),
		};
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper("room-1") });

		await performStartScreenShare(result, { mockDisplayStream: mockStream });

		const mockIncomingCall = { answer: vi.fn(), on: vi.fn(), close: vi.fn(), peer: "viewer-peer" };
		act(() => {
			peerHandlers["call"]?.(mockIncomingCall);
		});

		expect(mockIncomingCall.answer).toHaveBeenCalled();
		expect(mockIncomingCall.close).not.toHaveBeenCalled();
	});

	it("peerjs:streamer_changed calls cleanup when isStreamer is true", async () => {
		const mockStream = {
			getTracks: () => [],
			getVideoTracks: () => [],
			getAudioTracks: () => [],
			addTrack: vi.fn(),
			removeTrack: vi.fn(),
		};
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper("room-1") });

		await performStartScreenShare(result, { mockDisplayStream: mockStream });
		expect(result.current.isStreamer).toBe(true);

		await act(async () => {
			socketHandlers["peerjs:streamer_changed"]?.({
				newStreamerPeerId: "new-peer",
				newStreamerName: "Bob",
			});
		});

		expect(result.current.isStreamer).toBe(false);
		expect(mockDestroyPeer).toHaveBeenCalled();
	});

	it("peerjs:streamer_ready is ignored when isStreamer is true (no reconnect as viewer)", async () => {
		const mockStream = {
			getTracks: () => [],
			getVideoTracks: () => [],
			getAudioTracks: () => [],
			addTrack: vi.fn(),
			removeTrack: vi.fn(),
		};
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper("room-1") });

		await performStartScreenShare(result, { mockDisplayStream: mockStream });
		expect(result.current.isStreamer).toBe(true);

		// Clear call count so we can detect any new connection attempts
		mockGetOrCreatePeer.mockClear();

		// As the streamer, receiving streamer_ready should not trigger connectToStreamer
		act(() => {
			socketHandlers["peerjs:streamer_ready"]?.({
				streamerPeerId: "another-peer",
				streamerName: "Someone",
				audioConfig: "no-audio",
			});
		});

		expect(mockGetOrCreatePeer).not.toHaveBeenCalled();
	});

	it("toggleAudio toggles audio tracks when localStream is set", async () => {
		const mockAudioTrack = { stop: vi.fn(), enabled: true };
		const mockStream = {
			getTracks: () => [mockAudioTrack],
			getVideoTracks: () => [],
			getAudioTracks: () => [mockAudioTrack],
			addTrack: vi.fn(),
			removeTrack: vi.fn(),
		};
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper("room-1") });

		await performStartScreenShare(result, { mockDisplayStream: mockStream, audioConfig: "no-audio" });

		// Initially enabled — toggle to mute
		act(() => { result.current.toggleAudio(); });
		expect(mockAudioTrack.enabled).toBe(false);
		expect(result.current.isAudioEnabled).toBe(false);

		// Toggle back to unmute
		act(() => { result.current.toggleAudio(); });
		expect(mockAudioTrack.enabled).toBe(true);
		expect(result.current.isAudioEnabled).toBe(true);
	});

	it("system-and-mic audioConfig calls getUserMedia and adds mic track to stream", async () => {
		const mockMicTrack = { stop: vi.fn(), enabled: true };
		const mockDisplayStream = {
			getTracks: () => [],
			getVideoTracks: () => [],
			getAudioTracks: () => [],
			addTrack: vi.fn(),
			removeTrack: vi.fn(),
		};
		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		await performStartScreenShare(result, {
			mockDisplayStream,
			mockUserMediaStream: { getAudioTracks: () => [mockMicTrack] },
			audioConfig: "system-and-mic",
		});

		expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
		expect(mockDisplayStream.addTrack).toHaveBeenCalledWith(mockMicTrack);
	});
});

describe("StreamingProvider — startScreenShare errors", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearHandlerDicts();
	});

	it("throws 'Screen sharing not supported' when canStream is false", async () => {
		vi.mocked(detectDevice).mockReturnValueOnce({
			isMobile: true,
			canStream: false,
			canView: true,
			deviceType: "mobile",
			userAgent: "mobile-agent",
		});

		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		await expect(
			act(async () => {
				await result.current.startScreenShare({
					audioConfig: "no-audio",
					cursor: "always",
					displaySurface: "default",
				});
			}),
		).rejects.toThrow("Screen sharing not supported on this device");
	});

	it("sets lastError and resets isStreamer when getDisplayMedia rejects", async () => {
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getDisplayMedia: vi.fn().mockRejectedValue(new Error("Permission denied")),
			},
		});

		const { result } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });

		await act(async () => {
			try {
				await result.current.startScreenShare({
					audioConfig: "no-audio",
					cursor: "always",
					displaySurface: "default",
				});
			} catch {
				// expected to throw
			}
		});

		expect(result.current.lastError).toBe("Permission denied");
		expect(result.current.connectionStatus).toBe("idle");
		expect(result.current.isStreamer).toBe(false);
	});
});

describe("StreamingProvider — cleanup on unmount", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearHandlerDicts();
	});

	it("calls destroyPeer on unmount", () => {
		const { unmount } = renderHook(() => useStreaming(), { wrapper: makeWrapper() });
		unmount();
		expect(mockDestroyPeer).toHaveBeenCalled();
	});
});
