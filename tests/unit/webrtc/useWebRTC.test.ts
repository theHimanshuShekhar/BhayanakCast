/**
 * useWebRTC Hook Unit Tests
 *
 * Tests for screen sharing, peer connections, and transfer handling
 */

import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWebRTC } from "#/hooks/useWebRTC";
import { useWebSocket } from "#/lib/websocket-context";
import { detectDevice } from "#/lib/device-detection";

// Mock dependencies
vi.mock("#/lib/websocket-context");
vi.mock("#/lib/device-detection");
vi.mock("#/lib/webrtc-config");

// Mock WebRTC APIs
const mockGetDisplayMedia = vi.fn();
const mockGetUserMedia = vi.fn();
const mockRTCPeerConnection = vi.fn();

// Create mock MediaStream
const createMockMediaStream = (hasVideo = true, hasAudio = true) => {
	const tracks: MockMediaStreamTrack[] = [];

	if (hasVideo) {
		tracks.push({
			kind: "video",
			stop: vi.fn(),
			onended: null,
		} as MockMediaStreamTrack);
	}

	if (hasAudio) {
		tracks.push({
			kind: "audio",
			stop: vi.fn(),
			onended: null,
		} as MockMediaStreamTrack);
	}

	return {
		getTracks: () => tracks,
		getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
		getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
		addTrack: vi.fn(),
		removeTrack: vi.fn(),
	};
};

interface MockMediaStreamTrack {
	kind: string;
	stop: Mock;
	onended: (() => void) | null;
}

describe("useWebRTC Hook", () => {
	let mockSocket: {
		on: Mock;
		off: Mock;
		emit: Mock;
	};

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks();

		// Setup mock socket
		mockSocket = {
			on: vi.fn(),
			off: vi.fn(),
			emit: vi.fn(),
		};

		(vi.mocked(useWebSocket) as Mock).mockReturnValue({
			socket: mockSocket,
			isConnected: true,
		});

		// Mock device detection
		(vi.mocked(detectDevice) as Mock).mockReturnValue({
			isMobile: false,
			canStream: true,
			canView: true,
			deviceType: "desktop",
			userAgent: "Test",
		});

		// Mock WebRTC APIs
		Object.defineProperty(globalThis.navigator, "mediaDevices", {
			value: {
				getDisplayMedia: mockGetDisplayMedia,
				getUserMedia: mockGetUserMedia,
			},
			writable: true,
			configurable: true,
		});

		globalThis.RTCPeerConnection = mockRTCPeerConnection as unknown as typeof RTCPeerConnection;
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("Initialization", () => {
		it("initializes with correct default state", () => {
			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			expect(result.current.isScreenSharing).toBe(false);
			expect(result.current.isStreamer).toBe(false);
			expect(result.current.localStream).toBeNull();
			expect(result.current.remoteStream).toBeNull();
			expect(result.current.transferState).toBe("idle");
			expect(result.current.connectionStatus).toBe("idle");
		});

		it("sets up socket event listeners on mount", () => {
			renderHook(() => useWebRTC({ roomId: "test-room", userId: "user-1" }));

			expect(mockSocket.on).toHaveBeenCalledWith(
				"webrtc:offer",
				expect.any(Function),
			);
			expect(mockSocket.on).toHaveBeenCalledWith(
				"webrtc:answer",
				expect.any(Function),
			);
			expect(mockSocket.on).toHaveBeenCalledWith(
				"webrtc:ice_candidate",
				expect.any(Function),
			);
			expect(mockSocket.on).toHaveBeenCalledWith(
				"webrtc:transfer_initiating",
				expect.any(Function),
			);
			expect(mockSocket.on).toHaveBeenCalledWith(
				"webrtc:become_streamer",
				expect.any(Function),
			);
			expect(mockSocket.on).toHaveBeenCalledWith(
				"webrtc:reconnect_now",
				expect.any(Function),
			);
		});

		it("cleans up socket event listeners on unmount", () => {
			const { unmount } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			unmount();

			expect(mockSocket.off).toHaveBeenCalledWith("webrtc:offer", expect.any(Function));
			expect(mockSocket.off).toHaveBeenCalledWith("webrtc:answer", expect.any(Function));
			expect(mockSocket.off).toHaveBeenCalledWith(
				"webrtc:ice_candidate",
				expect.any(Function),
			);
			expect(mockSocket.off).toHaveBeenCalledWith(
				"webrtc:transfer_initiating",
				expect.any(Function),
			);
			expect(mockSocket.off).toHaveBeenCalledWith(
				"webrtc:become_streamer",
				expect.any(Function),
			);
			expect(mockSocket.off).toHaveBeenCalledWith(
				"webrtc:reconnect_now",
				expect.any(Function),
			);
		});
	});

	describe("Start Screen Sharing", () => {
		it("starts screen sharing with system audio + mic", async () => {
			const mockStream = createMockMediaStream();
			mockGetDisplayMedia.mockResolvedValue(mockStream);

			const mockMicStream = createMockMediaStream(false, true);
			mockGetUserMedia.mockResolvedValue(mockMicStream);

			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			await act(async () => {
				await result.current.startScreenShare({
					audioConfig: "system-and-mic",
					cursor: "always",
					displaySurface: "monitor",
				});
			});

			expect(mockGetDisplayMedia).toHaveBeenCalled();
			expect(mockGetUserMedia).toHaveBeenCalled();
			expect(result.current.isScreenSharing).toBe(true);
			expect(result.current.isStreamer).toBe(true);
			expect(mockSocket.emit).toHaveBeenCalledWith("webrtc:streamer_ready", {
				roomId: "test-room",
				audioConfig: "system-and-mic",
			});
		});

		it("starts screen sharing with microphone only", async () => {
			const mockStream = createMockMediaStream();
			mockGetDisplayMedia.mockResolvedValue(mockStream);

			const mockMicStream = createMockMediaStream(false, true);
			mockGetUserMedia.mockResolvedValue(mockMicStream);

			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			await act(async () => {
				await result.current.startScreenShare({
					audioConfig: "microphone-only",
					cursor: "always",
					displaySurface: "monitor",
				});
			});

			expect(result.current.isScreenSharing).toBe(true);
			expect(mockSocket.emit).toHaveBeenCalledWith("webrtc:streamer_ready", {
				roomId: "test-room",
				audioConfig: "microphone-only",
			});
		});

		it("starts screen sharing without audio", async () => {
			const mockStream = createMockMediaStream();
			mockGetDisplayMedia.mockResolvedValue(mockStream);

			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			await act(async () => {
				await result.current.startScreenShare({
					audioConfig: "no-audio",
					cursor: "always",
					displaySurface: "monitor",
				});
			});

			expect(result.current.isScreenSharing).toBe(true);
			expect(mockSocket.emit).toHaveBeenCalledWith("webrtc:streamer_ready", {
				roomId: "test-room",
				audioConfig: "no-audio",
			});
		});

		it("throws error when device cannot stream", async () => {
			(vi.mocked(detectDevice) as Mock).mockReturnValue({
				isMobile: true,
				canStream: false,
				canView: true,
				deviceType: "mobile",
				userAgent: "Mobile",
			});

			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			await expect(
				act(async () => {
					await result.current.startScreenShare({
						audioConfig: "system-and-mic",
						cursor: "always",
						displaySurface: "monitor",
					});
				}),
			).rejects.toThrow("Screen sharing not supported on this device");
		});

		it("handles getDisplayMedia error", async () => {
			mockGetDisplayMedia.mockRejectedValue(new Error("Permission denied"));

			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			await expect(
				act(async () => {
					await result.current.startScreenShare({
						audioConfig: "system-and-mic",
						cursor: "always",
						displaySurface: "monitor",
					});
				}),
			).rejects.toThrow("Permission denied");

			expect(result.current.isScreenSharing).toBe(false);
			expect(result.current.lastError).toBe("Permission denied");
		});
	});

	describe("Browser Stop Sharing Detection", () => {
		it("handles browser stop sharing button", async () => {
			const mockStream = createMockMediaStream();
			const videoTrack = mockStream.getVideoTracks()[0];
			mockGetDisplayMedia.mockResolvedValue(mockStream);
			mockGetUserMedia.mockResolvedValue(createMockMediaStream(false, true));

			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			await act(async () => {
				await result.current.startScreenShare({
					audioConfig: "system-and-mic",
					cursor: "always",
					displaySurface: "monitor",
				});
			});

			// Simulate browser stop sharing
			await act(async () => {
				if (videoTrack.onended) {
					videoTrack.onended();
				}
			});

			await waitFor(() => {
				expect(result.current.isScreenSharing).toBe(false);
				expect(mockSocket.emit).toHaveBeenCalledWith("webrtc:screen_share_ended", {
					roomId: "test-room",
				});
			});
		});
	});

	describe("Manual Stop Screen Sharing", () => {
		it("stops screen sharing manually", async () => {
			const mockStream = createMockMediaStream();
			mockGetDisplayMedia.mockResolvedValue(mockStream);
			mockGetUserMedia.mockResolvedValue(createMockMediaStream(false, true));

			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			await act(async () => {
				await result.current.startScreenShare({
					audioConfig: "system-and-mic",
					cursor: "always",
					displaySurface: "monitor",
				});
			});

			act(() => {
				result.current.stopScreenShare();
			});

			await waitFor(() => {
				expect(result.current.isScreenSharing).toBe(false);
				expect(result.current.isStreamer).toBe(false);
				expect(mockSocket.emit).toHaveBeenCalledWith("webrtc:screen_share_ended", {
					roomId: "test-room",
				});
			});
		});
	});

	describe("Transfer Handling", () => {
		it("handles transfer initiation", async () => {
			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			// Get the transfer_initiating handler
			const transferHandler = mockSocket.on.mock.calls.find(
				(call) => call[0] === "webrtc:transfer_initiating",
			)?.[1];

			act(() => {
				transferHandler({
					oldStreamerId: "user-1",
					newStreamerId: "user-2",
					reason: "streamer_left",
					estimatedReconnectAt: Date.now() + 5000,
					allParticipants: [
						{ userId: "user-1", userName: "User 1", isMobile: false },
						{ userId: "user-2", userName: "User 2", isMobile: false },
					],
				});
			});

			await waitFor(() => {
				expect(result.current.transferState).toBe("initiating");
				expect(result.current.transferInfo).toEqual({
					oldStreamerId: "user-1",
					newStreamerId: "user-2",
					reason: "streamer_left",
					estimatedReconnectAt: expect.any(Number),
				});
			});
		});

		it("handles become streamer event", async () => {
			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-1" }),
			);

			// Get the become_streamer handler
			const becomeStreamerHandler = mockSocket.on.mock.calls.find(
				(call) => call[0] === "webrtc:become_streamer",
			)?.[1];

			act(() => {
				becomeStreamerHandler({
					viewers: [{ userId: "user-2", userName: "User 2" }],
					startBroadcastingAt: Date.now() + 1500,
				});
			});

			await waitFor(() => {
				expect(result.current.transferState).toBe("waiting_for_streamer");
			});
		});

		it("handles reconnect now event for viewers", async () => {
			const { result } = renderHook(() =>
				useWebRTC({ roomId: "test-room", userId: "user-2" }),
			);

			// Get the reconnect_now handler
			const reconnectHandler = mockSocket.on.mock.calls.find(
				(call) => call[0] === "webrtc:reconnect_now",
			)?.[1];

			act(() => {
				reconnectHandler({
					newStreamerId: "user-1",
					newStreamerName: "User 1",
					streamerSocketId: "socket-1",
				});
			});

			await waitFor(() => {
				expect(result.current.transferState).toBe("reconnecting");
				expect(result.current.streamerId).toBe("user-1");
			});
		});
	});
});
