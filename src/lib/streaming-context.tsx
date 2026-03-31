/**
 * Streaming Context
 *
 * Single source of truth for PeerJS streaming state.
 * Replaces the usePeerJS hook to prevent duplicate instances
 * when multiple components need streaming state.
 *
 * Key design decisions:
 * - All mutable state used in PeerJS event handlers is stored in refs
 *   to avoid stale closure bugs
 * - Peer initialization is Promise-based (no polling)
 * - Context ensures one streaming instance per room
 *
 * @module lib/streaming-context
 */

import type { MediaConnection } from "peerjs";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ConnectionRetryManager } from "#/lib/connection-retry";
import { type DeviceCapabilities, detectDevice } from "#/lib/device-detection";
import { usePeerJSContext } from "#/lib/peerjs-context";
import { getDisplayMediaConstraints } from "#/lib/webrtc-config";
import { useWebSocket } from "#/lib/websocket-context";
import type {
	AudioConfig,
	ConnectionStatus,
	ScreenShareOptions,
} from "#/types/webrtc";

interface StreamingContextType {
	// State
	localStream: MediaStream | null;
	remoteStream: MediaStream | null;
	isScreenSharing: boolean;
	isStreamer: boolean;
	connectionStatus: ConnectionStatus;
	lastError: string | undefined;
	audioConfig: AudioConfig;
	isAudioEnabled: boolean;
	deviceCapabilities: DeviceCapabilities;
	retryAttempt: number;
	peerId: string | null;

	// Actions
	startScreenShare: (options: ScreenShareOptions) => Promise<void>;
	stopScreenShare: () => void;
	toggleAudio: () => void;
}

const StreamingContext = createContext<StreamingContextType | null>(null);

interface StreamingProviderProps {
	roomId: string;
	userId: string;
	streamerPeerId?: string | null;
	children: ReactNode;
}

export function StreamingProvider({
	roomId,
	userId,
	streamerPeerId,
	children,
}: StreamingProviderProps) {
	const { socket } = useWebSocket();
	const { getOrCreatePeer, destroyPeer: contextDestroyPeer } =
		usePeerJSContext();

	// Device capabilities (memoized once)
	const deviceCapabilities = useMemo(() => detectDevice(), []);

	// --- Refs (used in PeerJS event handlers to avoid stale closures) ---
	const peerRef = useRef<ReturnType<typeof getOrCreatePeer> | null>(null);
	const localStreamRef = useRef<MediaStream | null>(null);
	const currentCallRef = useRef<MediaConnection | null>(null);
	const isCleaningUpRef = useRef(false);
	const isStreamerRef = useRef(false);
	// Tracks whether the current peer has fired its "open" event.
	// A peer may have an .id before it is actually open (it's still connecting
	// to the PeerJS signaling server), so we track readiness separately.
	const isPeerOpenRef = useRef(false);
	const retryManagerRef = useRef<ConnectionRetryManager | null>(null);
	const socketRef = useRef(socket);
	const roomIdRef = useRef(roomId);
	// Ref to the latest streamerPeerId so the retry-on-close handler can reconnect
	const streamerPeerIdRef = useRef<string | null>(streamerPeerId ?? null);
	// Tracks peers that have already had listeners registered so that rapid
	// initPeerAsync retries on the same (not-yet-open) peer don't attach
	// duplicate "call"/"open"/"error" handlers.
	const peersWithListenersRef = useRef<WeakSet<object>>(new WeakSet());
	// Guards peerjs:screen_share_ended from being emitted twice (browser "Stop
	// sharing" button and UI Stop button can both fire concurrently).
	const hasEmittedShareEndedRef = useRef(false);

	// Keep refs in sync
	useEffect(() => {
		socketRef.current = socket;
	}, [socket]);
	useEffect(() => {
		roomIdRef.current = roomId;
	}, [roomId]);
	useEffect(() => {
		streamerPeerIdRef.current = streamerPeerId ?? null;
	}, [streamerPeerId]);

	// --- State (exposed to consumers) ---
	const [isScreenSharing, setIsScreenSharing] = useState(false);
	const [audioConfig, setAudioConfig] = useState<AudioConfig>("system-and-mic");
	const [localStream, setLocalStream] = useState<MediaStream | null>(null);
	const [isAudioEnabled, setIsAudioEnabled] = useState(true);
	const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
	const [isStreamer, setIsStreamer] = useState(false);
	const [connectionStatus, setConnectionStatus] =
		useState<ConnectionStatus>("idle");
	const [lastError, setLastError] = useState<string | undefined>();
	const [peerId, setPeerId] = useState<string | null>(null);
	const [retryAttempt, setRetryAttempt] = useState(0);

	// Keep isStreamer ref in sync with state
	useEffect(() => {
		isStreamerRef.current = isStreamer;
	}, [isStreamer]);

	/**
	 * Initialize PeerJS peer and return a Promise that resolves when open.
	 * If peer already exists and has fired its "open" event, resolves immediately.
	 */
	const initPeerAsync = useCallback((): Promise<string> => {
		// Already have a confirmed-open peer — reuse it
		if (
			peerRef.current &&
			!peerRef.current.destroyed &&
			isPeerOpenRef.current
		) {
			return Promise.resolve(peerRef.current.id);
		}

		// Peer exists but is reconnecting to the signaling server (e.g. transient
		// network drop). Wait for it to reopen rather than creating a brand-new peer
		// with a different timestamp ID — that would trigger an "ID mismatch" in
		// peerjs-context, destroy the still-alive peer, fire another "disconnected"
		// event, and spin forever.
		if (peerRef.current && !peerRef.current.destroyed) {
			const existingPeer = peerRef.current;
			return new Promise<string>((resolve, reject) => {
				const timeout = setTimeout(
					() => reject(new Error("PeerJS initialization timed out")),
					10000,
				);
				existingPeer.once("open", (id) => {
					clearTimeout(timeout);
					if (peerRef.current !== existingPeer) {
						reject(new Error("Peer replaced during reconnect"));
						return;
					}
					isPeerOpenRef.current = true;
					resolve(id);
				});
				existingPeer.once("error", (err) => {
					clearTimeout(timeout);
					reject(err);
				});
			});
		}

		// No peer or peer is fully destroyed — create a fresh one.
		// Strip non-alphanumeric characters so the generated ID satisfies PeerJS's
		// validation regex (no consecutive hyphens allowed; nanoid room IDs can contain them).
		const sanitize = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");
		const newPeerId = `${sanitize(roomId)}-${sanitize(userId)}-${Date.now()}`;
		const peer = getOrCreatePeer(newPeerId);
		peerRef.current = peer;
		isPeerOpenRef.current = false;

		// If this exact peer instance already has its listeners registered (e.g.
		// a rapid retry called initPeerAsync before the peer opened), return a
		// Promise that will resolve when the existing "open" handler fires.
		// Without this guard, each retry would attach duplicate handlers on the
		// same peer object, causing double-answer on incoming calls.
		if (peersWithListenersRef.current.has(peer)) {
			return new Promise<string>((resolve, reject) => {
				const timeout = setTimeout(
					() => reject(new Error("PeerJS initialization timed out")),
					10000,
				);
				peer.once("open", (id) => {
					clearTimeout(timeout);
					resolve(id);
				});
				peer.once("error", (err) => {
					clearTimeout(timeout);
					reject(err);
				});
			});
		}

		peersWithListenersRef.current.add(peer);

		return new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("PeerJS initialization timed out"));
			}, 10000);

			peer.on("open", (id) => {
				// Discard if a newer peer has replaced this one — prevents a stale
				// "open" callback from a destroyed peer writing its dead ID to state.
				if (peerRef.current !== peer) {
					clearTimeout(timeout);
					return;
				}
				clearTimeout(timeout);
				isPeerOpenRef.current = true;
				console.log("[PeerJS] Peer opened with ID:", id);
				setPeerId(id);

				// Only notify server when this is the streamer's peer.
				// Viewers emit peerjs:streamer_ready via startScreenShare, so this
				// avoids unnecessary rate-limit consumption on viewer connects.
				if (isStreamerRef.current) {
					socketRef.current?.emit("peerjs:ready", {
						roomId: roomIdRef.current,
						peerId: id,
					});
				}

				resolve(id);
			});

			peer.on("error", (error) => {
				if (peerRef.current !== peer) return;
				clearTimeout(timeout);
				isPeerOpenRef.current = false;
				console.error("[PeerJS] Error:", error);
				setLastError(error.message);
				reject(error);
			});

			peer.on("disconnected", () => {
				isPeerOpenRef.current = false;
				console.log("[PeerJS] Disconnected, attempting reconnect...");
				if (!peer.destroyed) {
					peer.reconnect();
				}
			});

			// Handle incoming calls (streamer receives from viewers)
			peer.on("call", (call) => {
				console.log("[PeerJS] Incoming call from:", call.peer);

				// Use REFS to check current state (not stale closure values)
				if (localStreamRef.current && isStreamerRef.current) {
					call.answer(localStreamRef.current);

					// Configure outbound video encoding to maintain 1080p quality
					const pc = (
						call as MediaConnection & {
							peerConnection?: RTCPeerConnection;
						}
					).peerConnection;
					if (pc) {
						const configureVideoEncoding = () => {
							pc.getSenders().forEach((sender) => {
								if (sender.track?.kind === "video") {
									const params = sender.getParameters();
									if (params.encodings?.length) {
										params.encodings[0].maxBitrate = 8_000_000; // 8 Mbps for 1080p
										params.encodings[0].maxFramerate = 60;
										sender.setParameters(params).catch(console.warn);
									}
								}
							});
						};
						if (
							pc.iceConnectionState === "connected" ||
							pc.iceConnectionState === "completed"
						) {
							configureVideoEncoding();
						} else {
							pc.addEventListener(
								"iceconnectionstatechange",
								function handler() {
									if (
										pc.iceConnectionState === "connected" ||
										pc.iceConnectionState === "completed"
									) {
										pc.removeEventListener("iceconnectionstatechange", handler);
										configureVideoEncoding();
									}
								},
							);
						}
					}

					call.on("close", () => {
						console.log("[PeerJS] Call with viewer closed");
					});

					call.on("error", (error) => {
						console.error("[PeerJS] Call error:", error);
					});
				} else {
					console.log(
						"[PeerJS] Rejecting call - not streaming. isStreamer:",
						isStreamerRef.current,
						"hasStream:",
						!!localStreamRef.current,
					);
					call.close();
				}
			});
		});
	}, [roomId, userId, getOrCreatePeer]);

	/**
	 * Cleanup all PeerJS and streaming resources
	 */
	const cleanup = useCallback(() => {
		if (isCleaningUpRef.current) return;
		isCleaningUpRef.current = true;

		console.log("[PeerJS] Cleaning up...");

		// Abort any in-progress retry
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

		// Stop local stream tracks
		localStreamRef.current?.getTracks().forEach((track) => {
			track.stop();
		});
		localStreamRef.current = null;
		setLocalStream(null);

		// Destroy peer via context and reset all peer-related refs
		contextDestroyPeer();
		peerRef.current = null;
		isPeerOpenRef.current = false;
		peersWithListenersRef.current = new WeakSet();
		setPeerId(null);

		// Reset state
		setIsScreenSharing(false);
		setIsStreamer(false);
		isStreamerRef.current = false;
		setRemoteStream(null);
		setConnectionStatus("idle");
		setIsAudioEnabled(true);

		isCleaningUpRef.current = false;
	}, [contextDestroyPeer]);

	/**
	 * Start screen sharing (streamer only)
	 */
	const startScreenShare = useCallback(
		async (options: ScreenShareOptions): Promise<void> => {
			if (!deviceCapabilities.canStream) {
				throw new Error("Screen sharing not supported on this device");
			}

			try {
				// Get display media with quality constraints (1080p @ ideal 30fps / max 60fps)
				const displayConstraints = getDisplayMediaConstraints({
					cursor: options.cursor,
					displaySurface: options.displaySurface,
				});
				const stream = await navigator.mediaDevices.getDisplayMedia({
					...displayConstraints,
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

				// Store stream in ref AND state
				localStreamRef.current = stream;
				setLocalStream(stream);

				// Reinforce quality constraints post-capture (some browsers ignore getDisplayMedia constraints)
				const videoTrack = stream.getVideoTracks()[0];
				if (videoTrack) {
					videoTrack
						.applyConstraints({
							width: { ideal: 1920, max: 1920 },
							height: { ideal: 1080, max: 1080 },
							frameRate: { ideal: 30, max: 60 },
						})
						.catch(() => {
							// Browser may not support all constraints — graceful fallback
						});
				}

				// Reset the share-ended dedup guard for this new streaming session
				hasEmittedShareEndedRef.current = false;

				// Listen for browser "Stop sharing" button
				if (videoTrack) {
					videoTrack.onended = () => {
						console.log("[PeerJS] User clicked Stop sharing button");
						cleanup();
						if (!hasEmittedShareEndedRef.current) {
							hasEmittedShareEndedRef.current = true;
							socketRef.current?.emit("peerjs:screen_share_ended", {
								roomId: roomIdRef.current,
							});
						}
					};
				}

				// Mark as streamer BEFORE peer init so call handler works
				setIsStreamer(true);
				isStreamerRef.current = true;
				setIsScreenSharing(true);
				setAudioConfig(options.audioConfig);
				setConnectionStatus("connected");

				// Initialize peer and emit streamer_ready
				const openPeerId = await initPeerAsync();
				socketRef.current?.emit("peerjs:streamer_ready", {
					roomId: roomIdRef.current,
					peerId: openPeerId,
					audioConfig: options.audioConfig,
				});

				console.log("[PeerJS] Screen sharing started, peerId:", openPeerId);
			} catch (error) {
				console.error("[PeerJS] Failed to start screen share:", error);
				// Reset streamer state on failure
				setIsStreamer(false);
				isStreamerRef.current = false;
				setIsScreenSharing(false);
				setConnectionStatus("idle");
				setLastError(
					error instanceof Error
						? error.message
						: "Failed to start screen sharing",
				);
				throw error;
			}
		},
		[deviceCapabilities.canStream, cleanup, initPeerAsync],
	);

	/**
	 * Stop screen sharing manually
	 */
	const stopScreenShare = useCallback(() => {
		cleanup();
		if (!hasEmittedShareEndedRef.current) {
			hasEmittedShareEndedRef.current = true;
			socketRef.current?.emit("peerjs:screen_share_ended", {
				roomId: roomIdRef.current,
			});
		}
	}, [cleanup]);

	/**
	 * Connect to streamer (viewer initiates) with retry logic
	 */
	const connectToStreamer = useCallback(
		async (targetStreamerPeerId: string): Promise<void> => {
			if (isStreamerRef.current) return;

			// Abort any existing retry
			retryManagerRef.current?.abort();
			retryManagerRef.current = new ConnectionRetryManager({
				maxRetries: 5,
				initialDelayMs: 1000,
				maxDelayMs: 30000,
				backoffMultiplier: 2,
				jitterFactor: 0.1,
			});

			// Capture the retry manager for this invocation. If a newer concurrent
			// call to connectToStreamer replaces retryManagerRef.current, the staleness
			// check below will cause this invocation to exit cleanly.
			const retryManager = retryManagerRef.current;

			while (retryManager.shouldRetry()) {
				// Exit if superseded by a newer connectToStreamer call
				if (retryManagerRef.current !== retryManager) return;

				try {
					console.log("[PeerJS] Connecting to streamer:", targetStreamerPeerId);
					retryManager.markConnecting();
					setConnectionStatus("connecting");

					// Initialize peer (Promise-based, no polling)
					await initPeerAsync();

					// Check again after the async gap — a concurrent call may have started
					if (retryManagerRef.current !== retryManager) return;

					if (!peerRef.current || peerRef.current.destroyed) {
						throw new Error("PeerJS not initialized");
					}

					// Call the streamer with an empty MediaStream, but tell the browser
					// to negotiate audio AND video receive sections in the SDP offer.
					// Without offerToReceiveAudio/Video, the offer has no media m= sections
					// (because the empty stream has no tracks), and the answerer (streamer)
					// cannot add media to a reply that the offer didn't negotiate — so the
					// viewer would never receive the screen-share stream.
					const call = peerRef.current.call(
						targetStreamerPeerId,
						new MediaStream(),
						{
							constraints: {
								offerToReceiveAudio: true,
								offerToReceiveVideo: true,
							},
						},
					);
					currentCallRef.current = call;

					// Set up stream handler
					call.on("stream", (stream) => {
						console.log("[PeerJS] Received stream from streamer");
						setRemoteStream(stream);
						setConnectionStatus("connected");
						setLastError(undefined);
						setRetryAttempt(0);
						retryManager.markSuccess();
					});

					// If the call closes unexpectedly (streamer disconnected), re-enter
					// the retry loop so we try to reconnect automatically.
					call.on("close", () => {
						console.log("[PeerJS] Call closed");
						setRemoteStream(null);
						if (!isCleaningUpRef.current && !isStreamerRef.current) {
							setConnectionStatus("failed");
							retryManager.recordError("Call closed unexpectedly");
						} else {
							setConnectionStatus("idle");
						}
					});

					call.on("error", (error) => {
						console.error("[PeerJS] Call error:", error);
						setLastError("Connection error");
						setConnectionStatus("failed");
						retryManager.recordError(error.message);
					});

					// Call initiated — wait for stream event (or close/error to re-loop)
					// Block here until the call result is known before attempting retry
					await new Promise<void>((resolve) => {
						call.once("stream", () => resolve());
						call.once("close", () => resolve());
						call.once("error", () => resolve());
					});

					// If we got a stream, success — exit the retry loop
					if (retryManager.getStatus() === "connected") {
						return;
					}

					// Call closed or errored without a stream — wait before retrying
					// (without this, the while-loop would spin immediately since
					// waitForRetry() is what increments the attempt counter)
					setRetryAttempt(retryManager.getState().attempt + 1);
					const shouldContinue = await retryManager.waitForRetry();
					if (!shouldContinue) {
						console.log("[PeerJS] Retry aborted");
						break;
					}
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
		[initPeerAsync],
	);

	/**
	 * Socket event listeners for streaming
	 */
	useEffect(() => {
		if (!socket) return;

		// Streamer ready — viewers should connect
		const handleStreamerReady = (data: {
			streamerPeerId: string;
			streamerName: string;
			audioConfig: AudioConfig;
		}) => {
			console.log("[PeerJS] Streamer ready:", data.streamerPeerId);
			setAudioConfig(data.audioConfig);

			// Connect if we're a viewer (not the streamer)
			if (
				!isStreamerRef.current &&
				data.streamerPeerId !== peerRef.current?.id
			) {
				void connectToStreamer(data.streamerPeerId);
			}
		};

		// Streamer changed — reconnect to new streamer
		const handleStreamerChanged = (data: {
			newStreamerPeerId: string | null;
			newStreamerName: string;
		}) => {
			console.log(
				"[PeerJS] Streamer changed to:",
				data.newStreamerPeerId ?? "(not yet registered)",
			);

			// If we were the outgoing streamer, stop our local stream and tear down
			// the peer so we stop answering viewer calls after the transfer.
			if (isStreamerRef.current) {
				console.log(
					"[PeerJS] We were the streamer — cleaning up after transfer",
				);
				cleanup();
				return;
			}

			// Abort any in-progress retry so we don't reconnect to the old streamer
			// (this is a no-op if connectToStreamer is not currently running).
			retryManagerRef.current?.abort();

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
			if (
				data.newStreamerPeerId &&
				data.newStreamerPeerId !== peerRef.current?.id
			) {
				void connectToStreamer(data.newStreamerPeerId);
			}
		};

		// Screen share ended
		const handleScreenShareEnded = () => {
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
		};

		socket.on("peerjs:streamer_ready", handleStreamerReady);
		socket.on("peerjs:streamer_changed", handleStreamerChanged);
		socket.on("peerjs:screen_share_ended", handleScreenShareEnded);

		return () => {
			socket.off("peerjs:streamer_ready", handleStreamerReady);
			socket.off("peerjs:streamer_changed", handleStreamerChanged);
			socket.off("peerjs:screen_share_ended", handleScreenShareEnded);
		};
	}, [socket, connectToStreamer, cleanup]);

	/**
	 * Auto-connect late joiners when streamerPeerId first appears in room state.
	 * Only depends on streamerPeerId — NOT on connectionStatus, which would re-fire
	 * this effect on every connecting→connected→failed transition and abort
	 * in-progress retry loops. The socket "peerjs:streamer_ready" handler already
	 * covers live updates; this effect only handles the initial/late-join case.
	 */
	useEffect(() => {
		if (!streamerPeerId || isStreamerRef.current) return;
		// Already have an active call — don't interrupt it
		if (currentCallRef.current) return;

		console.log(
			"[PeerJS] Late join: auto-connecting to streamer:",
			streamerPeerId,
		);
		void connectToStreamer(streamerPeerId);
	}, [streamerPeerId, connectToStreamer]);

	/**
	 * Cleanup on unmount
	 */
	useEffect(() => {
		return () => {
			cleanup();
		};
	}, [cleanup]);

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

	const value: StreamingContextType = useMemo(
		() => ({
			localStream,
			remoteStream,
			isScreenSharing,
			isStreamer,
			connectionStatus,
			lastError,
			audioConfig,
			isAudioEnabled,
			deviceCapabilities,
			retryAttempt,
			peerId,
			startScreenShare,
			stopScreenShare,
			toggleAudio,
		}),
		[
			localStream,
			remoteStream,
			isScreenSharing,
			isStreamer,
			connectionStatus,
			lastError,
			audioConfig,
			isAudioEnabled,
			deviceCapabilities,
			retryAttempt,
			peerId,
			startScreenShare,
			stopScreenShare,
			toggleAudio,
		],
	);

	return (
		<StreamingContext.Provider value={value}>
			{children}
		</StreamingContext.Provider>
	);
}

export function useStreaming(): StreamingContextType {
	const context = useContext(StreamingContext);
	if (!context) {
		throw new Error("useStreaming must be used within StreamingProvider");
	}
	return context;
}

/**
 * Optional version of useStreaming that returns null when outside StreamingProvider.
 * Use in components that may render with or without a StreamingProvider ancestor.
 */
export function useStreamingOptional(): StreamingContextType | null {
	return useContext(StreamingContext);
}
