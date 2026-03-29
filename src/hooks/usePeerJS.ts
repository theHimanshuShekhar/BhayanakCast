/**
 * PeerJS hook for screen sharing and viewing
 *
 * Simplified P2P screen sharing using PeerJS with Socket.io signaling
 * - PeerJS handles WebRTC connection (offer/answer/ICE)
 * - Socket.io exchanges PeerJS IDs for connection setup
 * - Much simpler than manual RTCPeerConnection management
 */

import type { MediaConnection } from "peerjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionRetryManager } from "#/lib/connection-retry";
import { detectDevice } from "#/lib/device-detection";
import { usePeerJSContext } from "#/lib/peerjs-context";
import { useWebSocket } from "#/lib/websocket-context";
import type {
	AudioConfig,
	ConnectionStatus,
	ScreenShareOptions,
} from "#/types/webrtc";

interface UsePeerJSOptions {
	roomId: string;
	userId: string;
	/** Peer ID of the current streamer, from room state. Used for late-joiner auto-connect. */
	streamerPeerId?: string | null;
}

export function usePeerJS({
	roomId,
	userId,
	streamerPeerId,
}: UsePeerJSOptions) {
	const { socket } = useWebSocket();
	const { getOrCreatePeer, destroyPeer: contextDestroyPeer } =
		usePeerJSContext();

	// Device capabilities
	const deviceCapabilities = useMemo(() => detectDevice(), []);

	// Refs
	const peerRef = useRef<Peer | null>(null);
	const localStreamRef = useRef<MediaStream | null>(null);
	const currentCallRef = useRef<MediaConnection | null>(null);
	const isCleaningUpRef = useRef(false);
	const pendingStreamerConfigRef = useRef<AudioConfig | null>(null);
	const retryManagerRef = useRef<ConnectionRetryManager | null>(null);

	// State
	const [isScreenSharing, setIsScreenSharing] = useState(false);
	const [audioConfig, setAudioConfig] = useState<AudioConfig>("system-and-mic");
	const [localStream, setLocalStream] = useState<MediaStream | null>(null);
	const [isAudioEnabled, setIsAudioEnabled] = useState(true);
	const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
	const [streamerId, setStreamerId] = useState<string | null>(null);
	const [isStreamer, setIsStreamer] = useState(false);
	const [connectionStatus, setConnectionStatus] =
		useState<ConnectionStatus>("idle");
	const [lastError, setLastError] = useState<string | undefined>();
	const [peerId, setPeerId] = useState<string | null>(null);
	const [retryAttempt, setRetryAttempt] = useState(0);

	/**
	 * Initialize PeerJS peer
	 */
	const initPeer = useCallback(() => {
		if (peerRef.current) return;

		// Generate unique peer ID with timestamp for reconnections
		const newPeerId = `${roomId}-${userId}-${Date.now()}`;

		// Use context singleton to prevent duplicate peer instances
		const peer = getOrCreatePeer(newPeerId);

		peer.on("open", (id) => {
			console.log("[PeerJS] Peer opened with ID:", id);
			setPeerId(id);

			// Notify server of our PeerJS ID
			socket?.emit("peerjs:ready", {
				roomId,
				peerId: id,
			});

			// If we're a streamer with pending config, emit ready
			if (pendingStreamerConfigRef.current) {
				socket?.emit("peerjs:streamer_ready", {
					roomId,
					peerId: id,
					audioConfig: pendingStreamerConfigRef.current,
				});
				pendingStreamerConfigRef.current = null;
			}
		});

		peer.on("error", (error) => {
			console.error("[PeerJS] Error:", error);
			setLastError(error.message);
		});

		peer.on("disconnected", () => {
			console.log("[PeerJS] Disconnected, attempting reconnect...");
			peer.reconnect();
		});

		// Handle incoming calls (streamer receives from viewers)
		peer.on("call", (call) => {
			console.log("[PeerJS] Incoming call from:", call.peer);

			// Answer with local stream if we're streaming
			if (localStreamRef.current && isStreamer) {
				call.answer(localStreamRef.current);
				currentCallRef.current = call;

				call.on("stream", (_remoteStream) => {
					console.log("[PeerJS] Received stream from viewer (unexpected)");
				});

				call.on("close", () => {
					console.log("[PeerJS] Call closed");
				});

				call.on("error", (error) => {
					console.error("[PeerJS] Call error:", error);
				});
			} else {
				// Not streaming, reject the call
				call.close();
			}
		});

		peerRef.current = peer;
	}, [roomId, userId, socket, isStreamer, getOrCreatePeer]);

	/**
	 * Cleanup PeerJS and streams
	 */
	const cleanup = useCallback(() => {
		if (isCleaningUpRef.current) return;
		isCleaningUpRef.current = true;

		console.log("[PeerJS] Cleaning up...");

		// Abort any in-progress retry to prevent state updates after unmount
		retryManagerRef.current?.abort();
		retryManagerRef.current = null;

		// Close current call
		if (currentCallRef.current) {
			try {
				currentCallRef.current.close();
			} catch (_e) {
				// Ignore
			}
			currentCallRef.current = null;
		}

		// Stop local stream
		localStreamRef.current?.getTracks().forEach((track) => {
			track.stop();
		});
		localStreamRef.current = null;
		setLocalStream(null);

		// Destroy peer via context (clears singleton)
		contextDestroyPeer();
		peerRef.current = null;
		setPeerId(null);

		// Reset state
		setIsScreenSharing(false);
		setIsStreamer(false);
		setRemoteStream(null);
		setConnectionStatus("idle");

		isCleaningUpRef.current = false;
	}, [contextDestroyPeer]);

	/**
	 * Start screen sharing
	 */
	const startScreenShare = useCallback(
		async (options: ScreenShareOptions): Promise<void> => {
			if (!deviceCapabilities.canStream) {
				throw new Error("Screen sharing not supported on this device");
			}

			try {
				// Get display media (screen share)
				const stream = await navigator.mediaDevices.getDisplayMedia({
					video: {
						cursor: options.cursor,
						displaySurface:
							options.displaySurface === "default"
								? undefined
								: (options.displaySurface as DisplayCaptureSurfaceType),
					} as MediaTrackConstraints,
					audio: options.audioConfig !== "no-audio",
				});

				// Handle audio configuration
				if (options.audioConfig === "system-and-mic") {
					try {
						const micStream = await navigator.mediaDevices.getUserMedia({
							audio: {
								echoCancellation: true,
								noiseSuppression: true,
							},
						});
						micStream.getAudioTracks().forEach((track) => {
							stream.addTrack(track);
						});
					} catch (err) {
						console.warn("[PeerJS] Could not get microphone:", err);
					}
				} else if (options.audioConfig === "no-audio") {
					stream.getAudioTracks().forEach((track) => {
						stream.removeTrack(track);
						track.stop();
					});
				}

				localStreamRef.current = stream;
				setLocalStream(stream);

				// Listen for browser "Stop sharing" button
				const videoTrack = stream.getVideoTracks()[0];
				if (videoTrack) {
					videoTrack.onended = () => {
						console.log("[PeerJS] User clicked Stop sharing button");
						cleanup();
						socket?.emit("peerjs:screen_share_ended", { roomId });
					};
				}

				// Store config for emission when peer opens
				pendingStreamerConfigRef.current = options.audioConfig;

				// Initialize PeerJS if not already
				if (!peerRef.current) {
					initPeer();
				} else if (peerRef.current?.id) {
					// Peer already open, emit immediately
					socket?.emit("peerjs:streamer_ready", {
						roomId,
						peerId: peerRef.current.id,
						audioConfig: options.audioConfig,
					});
					pendingStreamerConfigRef.current = null;
				}

				// Update state
				setIsScreenSharing(true);
				setAudioConfig(options.audioConfig);
				setIsStreamer(true);
				setConnectionStatus("connected");

				console.log("[PeerJS] Screen sharing started");
			} catch (error) {
				console.error("[PeerJS] Failed to start screen share:", error);
				setLastError(
					error instanceof Error
						? error.message
						: "Failed to start screen sharing",
				);
				throw error;
			}
		},
		[deviceCapabilities.canStream, roomId, socket, cleanup, initPeer],
	);

	/**
	 * Stop screen sharing manually
	 */
	const stopScreenShare = useCallback(() => {
		cleanup();
		socket?.emit("peerjs:screen_share_ended", { roomId });
	}, [cleanup, roomId, socket]);

	/**
	 * Connect to streamer (viewer initiates) with retry logic
	 */
	const connectToStreamer = useCallback(
		async (targetStreamerPeerId: string): Promise<void> => {
			if (isStreamer) return;

			// Initialize retry manager if needed
			if (!retryManagerRef.current) {
				retryManagerRef.current = new ConnectionRetryManager({
					maxRetries: 5,
					initialDelayMs: 1000,
					maxDelayMs: 30000,
					backoffMultiplier: 2,
					jitterFactor: 0.1,
				});
			}

			const retryManager = retryManagerRef.current;

			while (retryManager.shouldRetry()) {
				try {
					console.log("[PeerJS] Connecting to streamer:", targetStreamerPeerId);
					retryManager.markConnecting();

					// Initialize PeerJS if not already
					if (!peerRef.current) {
						initPeer();
						// Wait for peer to be ready
						await new Promise<void>((resolve) => {
							const checkPeer = setInterval(() => {
								if (peerRef.current?.id) {
									clearInterval(checkPeer);
									resolve();
								}
							}, 100);
							// Timeout after 5 seconds
							setTimeout(() => {
								clearInterval(checkPeer);
								resolve();
							}, 5000);
						});
					}

					if (!peerRef.current) {
						throw new Error("PeerJS not initialized");
					}

					// Call the streamer
					const call = peerRef.current.call(
						targetStreamerPeerId,
						new MediaStream(),
					);
					currentCallRef.current = call;

					// Set up stream handler
					call.on("stream", (remoteStream) => {
						console.log("[PeerJS] Received stream from streamer");
						setRemoteStream(remoteStream);
						setConnectionStatus("connected");
						setLastError(undefined);
						setRetryAttempt(0);
						retryManager.markSuccess();
					});

					call.on("close", () => {
						console.log("[PeerJS] Call closed");
						setRemoteStream(null);
						setConnectionStatus("idle");
					});

					call.on("error", (error) => {
						console.error("[PeerJS] Call error:", error);
						setLastError("Connection error");
						setConnectionStatus("failed");
						retryManager.recordError(error.message);
					});

					setStreamerId(targetStreamerPeerId);
					setConnectionStatus("connecting");

					// Wait for connection to establish
					return;
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					console.error(
						`[PeerJS] Connection attempt ${retryManager.getState().attempt} failed:`,
						errorMessage,
					);
					setLastError(`Connection failed: ${errorMessage}`);
					setConnectionStatus("failed");
					retryManager.recordError(errorMessage);

					// Try again if we haven't exceeded max retries
					if (retryManager.shouldRetry()) {
						setRetryAttempt(retryManager.getState().attempt);
						const shouldContinue = await retryManager.waitForRetry();
						if (!shouldContinue) {
							console.log("[PeerJS] Retry aborted");
							break;
						}
					} else {
						console.error("[PeerJS] Max retries exceeded");
						break;
					}
				}
			}
		},
		[isStreamer, initPeer],
	);

	/**
	 * Socket event listeners
	 */
	useEffect(() => {
		if (!socket) return;

		// Streamer ready - viewers should connect
		socket.on(
			"peerjs:streamer_ready",
			(data: {
				streamerPeerId: string;
				streamerName: string;
				audioConfig: AudioConfig;
			}) => {
				console.log("[PeerJS] Streamer ready:", data.streamerPeerId);
				setAudioConfig(data.audioConfig);

				// Connect if we're a viewer
				if (!isStreamer && data.streamerPeerId !== peerId) {
					connectToStreamer(data.streamerPeerId);
				}
			},
		);

		// Streamer changed - reconnect to new streamer
		socket.on(
			"peerjs:streamer_changed",
			(data: { newStreamerPeerId: string | null; newStreamerName: string }) => {
				console.log(
					"[PeerJS] Streamer changed to:",
					data.newStreamerPeerId ?? "(not yet registered)",
				);

				// Close existing call
				if (currentCallRef.current) {
					try {
						currentCallRef.current.close();
					} catch (_e) {
						// Ignore
					}
					currentCallRef.current = null;
				}

				setRemoteStream(null);

				// Connect to new streamer if peer ID is known and it's not us
				// If null, wait for room:state_sync once new streamer calls peerjs:streamer_ready
				if (data.newStreamerPeerId && data.newStreamerPeerId !== peerId) {
					connectToStreamer(data.newStreamerPeerId);
				}
			},
		);

		// Screen share ended
		socket.on("peerjs:screen_share_ended", () => {
			console.log("[PeerJS] Screen share ended by streamer");
			setRemoteStream(null);
			setConnectionStatus("idle");

			if (currentCallRef.current) {
				try {
					currentCallRef.current.close();
				} catch (_e) {
					// Ignore
				}
				currentCallRef.current = null;
			}
		});

		return () => {
			socket.off("peerjs:streamer_ready");
			socket.off("peerjs:streamer_changed");
			socket.off("peerjs:screen_share_ended");
		};
	}, [socket, isStreamer, peerId, connectToStreamer]);

	/**
	 * Initialize PeerJS when user joins room
	 */
	useEffect(() => {
		if (!socket) return;

		// Initialize peer for all users (streamers and viewers)
		// This ensures we're ready when needed
		if (!peerRef.current) {
			initPeer();
		}

		return () => {
			cleanup();
		};
	}, [socket, initPeer, cleanup]);

	/**
	 * Auto-connect late joiners when streamerPeerId appears in room state.
	 * This handles the case where a viewer joins after the streamer is already ready,
	 * so no new peerjs:streamer_ready event will fire for them.
	 */
	useEffect(() => {
		if (!streamerPeerId || isStreamer) return;
		// Don't reconnect if already connected to this peer
		if (streamerId === streamerPeerId && connectionStatus === "connected")
			return;

		console.log(
			"[PeerJS] Late join: auto-connecting to streamer:",
			streamerPeerId,
		);
		void connectToStreamer(streamerPeerId);
	}, [
		streamerPeerId,
		isStreamer,
		streamerId,
		connectionStatus,
		connectToStreamer,
	]);

	/**
	 * Toggle audio mute/unmute
	 */
	const toggleAudio = useCallback(() => {
		if (!localStreamRef.current) return;

		const audioTracks = localStreamRef.current.getAudioTracks();
		const hasEnabledTrack = audioTracks.some((track) => track.enabled);

		audioTracks.forEach((track) => {
			track.enabled = !hasEnabledTrack;
		});

		console.log(`[PeerJS] Audio ${hasEnabledTrack ? "muted" : "unmuted"}`);
		setIsAudioEnabled(!hasEnabledTrack);
	}, []);

	return {
		// State
		localStream,
		remoteStream,
		isScreenSharing,
		audioConfig,
		isStreamer,
		streamerId,
		connectionStatus,
		lastError,
		deviceCapabilities,
		isAudioEnabled,
		peerId,
		retryAttempt,

		// Actions
		startScreenShare,
		stopScreenShare,
		connectToStreamer,
		toggleAudio,
	};
}
