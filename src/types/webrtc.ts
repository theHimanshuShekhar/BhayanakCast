/**
 * WebRTC type definitions for screen sharing
 */

import type { DeviceCapabilities } from "#/lib/device-detection";

// Audio configuration options
export type AudioConfig =
	| "system-and-mic" // System audio + microphone
	| "system-only" // System audio only
	| "no-audio"; // No audio

// Screen sharing options
export interface ScreenShareOptions {
	audioConfig: AudioConfig;
	cursor: "always" | "motion" | "never";
	displaySurface: "monitor" | "window" | "browser" | "default";
}

// Peer connection state
export interface PeerConnectionState {
	connection: RTCPeerConnection;
	userId: string;
	userName: string;
	connectionState: RTCPeerConnectionState;
	iceConnectionState: RTCIceConnectionState;
	signalingState: RTCSignalingState;
	dataChannel?: RTCDataChannel;
	remoteStream?: MediaStream;
}

// WebRTC connection status
export type ConnectionStatus =
	| "idle"
	| "connecting"
	| "connected"
	| "disconnected"
	| "failed"
	| "closed";

// Transfer state during streamer handoff
export type TransferState =
	| "idle"
	| "initiating"
	| "cleaning_up"
	| "waiting_for_streamer"
	| "reconnecting"
	| "connected"
	| "failed";

// Transfer information
export interface TransferInfo {
	oldStreamerId?: string;
	newStreamerId?: string;
	reason?: "streamer_left" | "manual_transfer";
	newStreamerName?: string;
	estimatedReconnectAt?: number;
}

// WebRTC state managed by useWebRTC hook
export interface WebRTCState {
	// Local media
	localStream: MediaStream | null;
	isScreenSharing: boolean;
	audioConfig: AudioConfig;
	screenShareOptions: ScreenShareOptions;

	// Remote streams (viewer receives one, streamer has none)
	remoteStreams: Map<string, MediaStream>;

	// Connection management
	peerConnections: Map<string, PeerConnectionState>;
	streamerId: string | null;
	isStreamer: boolean;

	// Transfer state
	transferState: TransferState;
	transferInfo: TransferInfo | null;

	// Connection status
	connectionStatus: ConnectionStatus;
	reconnectAttempts: number;
	lastError?: string;

	// Device capabilities
	deviceCapabilities: DeviceCapabilities;
}

// Socket.io event payloads

// Server -> Client events
export interface TransferInitiatingEvent {
	oldStreamerId: string;
	newStreamerId: string;
	reason: "streamer_left" | "manual_transfer";
	estimatedReconnectAt: number;
	allParticipants: Array<{
		userId: string;
		userName: string;
		isMobile: boolean;
	}>;
}

export interface BecomeStreamerEvent {
	viewers: Array<{
		userId: string;
		userName: string;
	}>;
	startBroadcastingAt: number;
}

export interface ReconnectNowEvent {
	newStreamerId: string;
	newStreamerName: string;
	streamerSocketId: string;
}

export interface WebRTCOfferEvent {
	fromUserId: string;
	fromUserName: string;
	offer: RTCSessionDescriptionInit;
}

export interface WebRTCAnswerEvent {
	fromUserId: string;
	answer: RTCSessionDescriptionInit;
}

export interface WebRTCICECandidateEvent {
	fromUserId: string;
	candidate: RTCIceCandidateInit;
}

export interface StreamerReadyEvent {
	streamerId: string;
	streamerName: string;
	audioConfig: AudioConfig;
}

export interface StreamEndedEvent {
	streamerId: string;
	reason: "stopped" | "transfer" | "error";
}

// Client -> Server events
export interface StreamerReadyPayload {
	roomId: string;
	audioConfig: AudioConfig;
}

export interface WebRTCOfferPayload {
	roomId: string;
	toUserId: string;
	offer: RTCSessionDescriptionInit;
}

export interface WebRTCAnswerPayload {
	roomId: string;
	toUserId: string;
	answer: RTCSessionDescriptionInit;
}

export interface WebRTCICECandidatePayload {
	roomId: string;
	toUserId: string;
	candidate: RTCIceCandidateInit;
}

export interface ConnectionStatePayload {
	roomId: string;
	targetUserId: string;
	state: RTCPeerConnectionState;
}

export interface ScreenShareEndedPayload {
	roomId: string;
}

// RTC Configuration
export interface RTCConfig {
	iceServers: RTCIceServer[];
	bundlePolicy: RTCBundlePolicy;
	rtcpMuxPolicy: RTCRtcpMuxPolicy;
	iceCandidatePoolSize: number;
}

// Simulcast encoding
export interface SimulcastEncoding {
	rid: string;
	maxBitrate: number;
	scaleResolutionDownBy?: number;
}

// WebRTC logging
export interface WebRTCLog {
	event: string;
	roomId: string;
	userId: string;
	timestamp: number;
	data?: Record<string, unknown>;
}
