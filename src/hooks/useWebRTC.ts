/**
 * WebRTC hook for screen sharing and viewing
 *
 * Manages peer connections for P2P screen sharing with:
 * - Screen sharing (getDisplayMedia)
 * - Audio configuration (system+mic/mic-only/none)
 * - Mobile detection and restrictions
 * - Graceful streamer transfer handling
 * - Browser "Stop sharing" detection
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectDevice } from "#/lib/device-detection";
import {
	getDisplayMediaConstraints,
	getRTCConfiguration,
	getUserMediaConstraints,
} from "#/lib/webrtc-config";
import { useWebSocket } from "#/lib/websocket-context";
import type {
	AudioConfig,
	BecomeStreamerEvent,
	ConnectionStatus,
	PeerConnectionState,
	ReconnectNowEvent,
	ScreenShareOptions,
	TransferInfo,
	TransferInitiatingEvent,
	TransferState,
	WebRTCAnswerEvent,
	WebRTCICECandidateEvent,
	WebRTCOfferEvent,
} from "#/types/webrtc";

interface UseWebRTCOptions {
	roomId: string;
	userId: string;
}

export function useWebRTC({ roomId, userId }: UseWebRTCOptions) {
	const { socket } = useWebSocket();

	// Device capabilities (computed once)
	const deviceCapabilities = useMemo(() => detectDevice(), []);

	// Refs for mutable state
	const localStreamRef = useRef<MediaStream | null>(null);
	const peerConnectionsRef = useRef<Map<string, PeerConnectionState>>(
		new Map(),
	);
	const isCleaningUpRef = useRef(false);

	// State
	const [isScreenSharing, setIsScreenSharing] = useState(false);
	const [audioConfig, setAudioConfig] = useState<AudioConfig>("system-and-mic");
	const [localStream, setLocalStream] = useState<MediaStream | null>(null);
	const [isAudioEnabled, setIsAudioEnabled] = useState(true);
	const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
		new Map(),
	);
	const [streamerId, setStreamerId] = useState<string | null>(null);
	const [isStreamer, setIsStreamer] = useState(false);
	const [transferState, setTransferState] = useState<TransferState>("idle");
	const [transferInfo, setTransferInfo] = useState<TransferInfo | null>(null);
	const [connectionStatus, setConnectionStatus] =
		useState<ConnectionStatus>("idle");
	const [lastError, setLastError] = useState<string | undefined>();

	/**
	 * Handle screen share ended (browser button or manual)
	 * Must be defined BEFORE startScreenShare to avoid dependency issues
	 */
	const handleScreenShareEnded = useCallback(() => {
		if (isCleaningUpRef.current) return;
		isCleaningUpRef.current = true;

		console.log("[WebRTC] Handling screen share ended");

		// Stop all tracks
		localStreamRef.current?.getTracks().forEach((track) => {
			track.stop();
		});
		localStreamRef.current = null;
		setLocalStream(null);

		// Close all peer connections
		peerConnectionsRef.current.forEach((peerState) => {
			try {
				peerState.connection.close();
			} catch (_e) {
				// Ignore errors during cleanup
			}
		});
		peerConnectionsRef.current.clear();

		// Update state
		setIsScreenSharing(false);
		setIsStreamer(false);
		setRemoteStreams(new Map());
		setConnectionStatus("idle");

		// Notify server
		socket?.emit("webrtc:screen_share_ended", { roomId });

		isCleaningUpRef.current = false;
	}, [roomId, socket]);

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
				const constraints = getDisplayMediaConstraints({
					cursor: options.cursor,
					displaySurface: options.displaySurface,
				});

				const stream =
					await navigator.mediaDevices.getDisplayMedia(constraints);

				// Handle audio configuration
				if (options.audioConfig === "system-and-mic") {
					// Add microphone track to stream with system audio
					try {
						const micStream = await navigator.mediaDevices.getUserMedia(
							getUserMediaConstraints(),
						);
						micStream.getAudioTracks().forEach((track) => {
							stream.addTrack(track);
						});
					} catch (err) {
						console.warn("[WebRTC] Could not get microphone:", err);
						// Continue with system audio only
					}
				} else if (options.audioConfig === "system-only") {
					// Stream already has system audio from getDisplayMedia
					// No microphone needed - keep as is
					console.log("[WebRTC] Using system audio only (no microphone)");
				}
				// For "no-audio", we keep the stream as-is (remove audio tracks)
				else if (options.audioConfig === "no-audio") {
					stream.getAudioTracks().forEach((track) => {
						stream.removeTrack(track);
						track.stop();
					});
				}

				localStreamRef.current = stream;
				setLocalStream(stream);
				console.log(
					"[WebRTC] Local stream set:",
					stream.id,
					"Tracks:",
					stream
						.getTracks()
						.map((t) => `${t.kind}:${t.readyState}`)
						.join(", "),
				);

				// CRITICAL: Listen for browser "Stop sharing" button
				const videoTrack = stream.getVideoTracks()[0];
				if (videoTrack) {
					videoTrack.onended = () => {
						console.log("[WebRTC] User clicked browser Stop sharing button");
						handleScreenShareEnded();
					};
				}

				// Update state
				setIsScreenSharing(true);
				setAudioConfig(options.audioConfig);
				setIsStreamer(true);
				setConnectionStatus("connected");

				// Notify server
				socket?.emit("webrtc:streamer_ready", {
					roomId,
					audioConfig: options.audioConfig,
				});

				console.log("[WebRTC] Screen sharing started");
			} catch (error) {
				console.error("[WebRTC] Failed to start screen share:", error);
				setLastError(
					error instanceof Error
						? error.message
						: "Failed to start screen sharing",
				);
				throw error;
			}
		},
		[deviceCapabilities.canStream, roomId, socket, handleScreenShareEnded],
	);

	/**
	 * Stop screen sharing manually
	 */
	const stopScreenShare = useCallback(() => {
		handleScreenShareEnded();
	}, [handleScreenShareEnded]);

	/**
	 * Cleanup on unmount
	 */
	useEffect(() => {
		return () => {
			handleScreenShareEnded();
		};
	}, [handleScreenShareEnded]);

	/**
	 * Handle incoming offer (streamer receives from viewer)
	 */
	const handleOffer = useCallback(
		async (fromUserId: string, offer: RTCSessionDescriptionInit) => {
			if (!isStreamer || !localStreamRef.current) return;

			console.log(`[WebRTC] Received offer from ${fromUserId}`);

			const pc = new RTCPeerConnection(getRTCConfiguration());

			// Add local stream tracks
			localStreamRef.current.getTracks().forEach((track) => {
				if (localStreamRef.current) {
					pc.addTrack(track, localStreamRef.current);
				}
			});

			// Handle ICE candidates
			pc.onicecandidate = (event) => {
				if (event.candidate) {
					socket?.emit("webrtc:ice_candidate", {
						roomId,
						toUserId: fromUserId,
						candidate: event.candidate,
					});
				}
			};

			// Set remote description and create answer
			await pc.setRemoteDescription(offer);
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);

			// Send answer
			socket?.emit("webrtc:answer", {
				roomId,
				toUserId: fromUserId,
				answer,
			});

			// Store connection
			const peerState: PeerConnectionState = {
				connection: pc,
				userId: fromUserId,
				userName: "",
				connectionState: "connecting",
				iceConnectionState: "new",
				signalingState: "have-remote-offer",
			};

			peerConnectionsRef.current.set(fromUserId, peerState);

			// Monitor connection state changes for ICE restart
			pc.onconnectionstatechange = () => {
				console.log(`[WebRTC] Connection state: ${pc.connectionState}`);
				peerState.connectionState = pc.connectionState;

				if (pc.connectionState === "failed") {
					console.error(`[WebRTC] Connection failed with ${fromUserId}`);
					setLastError("Connection lost. Attempting to reconnect...");
					// Attempt ICE restart
					pc.restartIce();
				}
			};

			pc.oniceconnectionstatechange = () => {
				console.log(`[WebRTC] ICE state: ${pc.iceConnectionState}`);
				peerState.iceConnectionState = pc.iceConnectionState;
			};
		},
		[isStreamer, roomId, socket],
	);

	/**
	 * Handle incoming answer (viewer receives from streamer)
	 */
	const handleAnswer = useCallback(
		async (fromUserId: string, answer: RTCSessionDescriptionInit) => {
			const peerState = peerConnectionsRef.current.get(fromUserId);
			if (!peerState) return;

			console.log(`[WebRTC] Received answer from ${fromUserId}`);
			await peerState.connection.setRemoteDescription(answer);
		},
		[],
	);

	/**
	 * Handle ICE candidate
	 */
	const handleIceCandidate = useCallback(
		async (fromUserId: string, candidate: RTCIceCandidateInit) => {
			const peerState = peerConnectionsRef.current.get(fromUserId);
			if (!peerState) return;

			try {
				await peerState.connection.addIceCandidate(
					new RTCIceCandidate(candidate),
				);
			} catch (_e) {
				console.warn("[WebRTC] Error adding ICE candidate:", _e);
			}
		},
		[],
	);

	/**
	 * Connect to streamer (viewer initiates)
	 */
	const connectToStreamer = useCallback(
		async (targetStreamerId: string): Promise<void> => {
			if (isStreamer) return;

			console.log(`[WebRTC] Connecting to streamer ${targetStreamerId}`);

			try {
				const pc = new RTCPeerConnection(getRTCConfiguration());

				// Set up to receive remote stream
				const remoteStream = new MediaStream();

				pc.ontrack = (event) => {
					console.log(`[WebRTC] Received remote track: ${event.track.kind}`);
					remoteStream.addTrack(event.track);
					setRemoteStreams((prev) =>
						new Map(prev).set(targetStreamerId, remoteStream),
					);
				};

				// Handle ICE candidates
				pc.onicecandidate = (event) => {
					if (event.candidate) {
						socket?.emit("webrtc:ice_candidate", {
							roomId,
							toUserId: targetStreamerId,
							candidate: event.candidate,
						});
					}
				};

				// Create and send offer
				const offer = await pc.createOffer({
					offerToReceiveAudio: true,
					offerToReceiveVideo: true,
				});

				await pc.setLocalDescription(offer);

				// Store connection
				const peerState: PeerConnectionState = {
					connection: pc,
					userId: targetStreamerId,
					userName: "",
					connectionState: "connecting",
					iceConnectionState: "new",
					signalingState: "have-local-offer",
					remoteStream,
				};

				peerConnectionsRef.current.set(targetStreamerId, peerState);

				// Send offer
				socket?.emit("webrtc:offer", {
					roomId,
					toUserId: targetStreamerId,
					offer,
				});

				setStreamerId(targetStreamerId);
				setConnectionStatus("connecting");

				// Monitor connection state changes for ICE restart
				pc.onconnectionstatechange = () => {
					console.log(`[WebRTC] Connection state: ${pc.connectionState}`);
					peerState.connectionState = pc.connectionState;

					if (pc.connectionState === "failed") {
						console.error(
							`[WebRTC] Connection failed with streamer ${targetStreamerId}`,
						);
						setLastError("Connection lost. Attempting to reconnect...");
						// Attempt ICE restart
						pc.restartIce();
					}
				};

				pc.oniceconnectionstatechange = () => {
					console.log(`[WebRTC] ICE state: ${pc.iceConnectionState}`);
					peerState.iceConnectionState = pc.iceConnectionState;
				};
			} catch (error) {
				console.error("[WebRTC] Failed to connect to streamer:", error);
				setLastError("Failed to connect to stream");
			}
		},
		[isStreamer, roomId, socket],
	);

	/**
	 * Handle transfer initiation
	 */
	const handleTransferInitiating = useCallback(
		async (data: TransferInitiatingEvent) => {
			console.log("[WebRTC] Transfer initiating", data);

			setTransferState("initiating");
			setTransferInfo({
				oldStreamerId: data.oldStreamerId,
				newStreamerId: data.newStreamerId,
				reason: data.reason,
				estimatedReconnectAt: data.estimatedReconnectAt,
			});

			// If we're the old streamer, stop sharing
			if (data.oldStreamerId === userId && isScreenSharing) {
				await handleScreenShareEnded();
			}

			// If we're a viewer, close connection to old streamer
			if (!isStreamer && streamerId) {
				const peerState = peerConnectionsRef.current.get(streamerId);
				if (peerState) {
					try {
						peerState.connection.close();
					} catch (_e) {
						// Ignore
					}
					peerConnectionsRef.current.delete(streamerId);
				}
				setRemoteStreams(new Map());
			}
		},
		[userId, isScreenSharing, isStreamer, streamerId, handleScreenShareEnded],
	);

	/**
	 * Handle becoming streamer
	 */
	const handleBecomeStreamer = useCallback((data: BecomeStreamerEvent) => {
		console.log("[WebRTC] Becoming streamer", data);
		setTransferState("waiting_for_streamer");
		// Don't auto-start - user must click "Start Streaming"
	}, []);

	/**
	 * Handle reconnect now
	 */
	const handleReconnectNow = useCallback(
		(data: ReconnectNowEvent) => {
			console.log("[WebRTC] Reconnect now", data);
			setTransferState("reconnecting");
			setStreamerId(data.newStreamerId);

			// If not the new streamer, connect to them
			if (data.newStreamerId !== userId) {
				connectToStreamer(data.newStreamerId);
			}
		},
		[userId, connectToStreamer],
	);

	/**
	 * Socket event listeners
	 */
	useEffect(() => {
		if (!socket) return;

		// WebRTC signaling events
		socket.on("webrtc:offer", (data: WebRTCOfferEvent) => {
			handleOffer(data.fromUserId, data.offer);
		});

		socket.on("webrtc:answer", (data: WebRTCAnswerEvent) => {
			handleAnswer(data.fromUserId, data.answer);
		});

		socket.on("webrtc:ice_candidate", (data: WebRTCICECandidateEvent) => {
			handleIceCandidate(data.fromUserId, data.candidate);
		});

		// Transfer events
		socket.on("webrtc:transfer_initiating", (data: TransferInitiatingEvent) => {
			handleTransferInitiating(data);
		});

		socket.on("webrtc:become_streamer", (data: BecomeStreamerEvent) => {
			handleBecomeStreamer(data);
		});

		socket.on("webrtc:reconnect_now", (data: ReconnectNowEvent) => {
			handleReconnectNow(data);
		});

		return () => {
			socket.off("webrtc:offer");
			socket.off("webrtc:answer");
			socket.off("webrtc:ice_candidate");
			socket.off("webrtc:transfer_initiating");
			socket.off("webrtc:become_streamer");
			socket.off("webrtc:reconnect_now");
		};
	}, [
		socket,
		handleOffer,
		handleAnswer,
		handleIceCandidate,
		handleTransferInitiating,
		handleBecomeStreamer,
		handleReconnectNow,
	]);

	// Get the first remote stream (for viewers)
	const remoteStream = useMemo(() => {
		return remoteStreams.values().next().value || null;
	}, [remoteStreams]);

	/**
	 * Toggle audio mute/unmute
	 */
	const toggleAudio = useCallback(() => {
		if (!localStreamRef.current) return;

		const audioTracks = localStreamRef.current.getAudioTracks();
		const hasEnabledTrack = audioTracks.some((track) => track.enabled);

		// Toggle all audio tracks
		audioTracks.forEach((track) => {
			track.enabled = !hasEnabledTrack;
		});

		console.log(`[WebRTC] Audio ${hasEnabledTrack ? "muted" : "unmuted"}`);
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
		transferState,
		transferInfo,
		connectionStatus,
		lastError,
		deviceCapabilities,
		isAudioEnabled,

		// Actions
		startScreenShare,
		stopScreenShare,
		connectToStreamer,
		toggleAudio,
	};
}
