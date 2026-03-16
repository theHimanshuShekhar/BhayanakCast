/**
 * WebRTC configuration utilities
 */

/**
 * Get RTC configuration with STUN/TURN servers
 */
export function getRTCConfiguration(): RTCConfiguration {
	const iceServers: RTCIceServer[] = [
		// Public STUN servers
		{ urls: "stun:stun.l.google.com:19302" },
		{ urls: "stun:stun1.l.google.com:19302" },
		{ urls: "stun:stun2.l.google.com:19302" },
	];

	// Add TURN servers from environment if available
	if (import.meta.env.VITE_TURN_SERVER_URL) {
		iceServers.push({
			urls: import.meta.env.VITE_TURN_SERVER_URL,
			username: import.meta.env.VITE_TURN_USERNAME || "",
			credential: import.meta.env.VITE_TURN_PASSWORD || "",
		});
	}

	// Cloudflare Calls TURN (recommended)
	if (import.meta.env.VITE_CLOUDFLARE_TURN_TOKEN) {
		iceServers.push({
			urls: "turn:turn.cloudflare.com:3478",
			username: "cloudflare-turn",
			credential: import.meta.env.VITE_CLOUDFLARE_TURN_TOKEN,
		});
	}

	return {
		iceServers,
		iceTransportPolicy: "all",
		bundlePolicy: "max-bundle",
		rtcpMuxPolicy: "require",
		iceCandidatePoolSize: 10,
	};
}

/**
 * Get simulcast encodings for screen sharing
 * Provides multiple quality layers for adaptive streaming
 */
export function getSimulcastEncodings(): RTCRtpEncodingParameters[] {
	return [
		{
			rid: "high",
			maxBitrate: 4000000, // 4 Mbps for 1080p
			scaleResolutionDownBy: 1,
		},
		{
			rid: "medium",
			maxBitrate: 1500000, // 1.5 Mbps for 720p
			scaleResolutionDownBy: 1.5,
		},
		{
			rid: "low",
			maxBitrate: 500000, // 0.5 Mbps for 480p
			scaleResolutionDownBy: 2.25,
		},
	];
}

/**
 * Get display media constraints for screen sharing
 */
export function getDisplayMediaConstraints(options: {
	cursor: "always" | "motion" | "never";
	displaySurface: "monitor" | "window" | "browser" | "default";
}): DisplayMediaStreamOptions {
	return {
		video: {
			cursor: options.cursor,
			displaySurface:
				options.displaySurface === "default"
					? undefined
					: options.displaySurface,
			width: { ideal: 1920, max: 1920 },
			height: { ideal: 1080, max: 1080 },
			frameRate: { ideal: 30, max: 30 },
		} as MediaTrackConstraints,
		audio: true, // We'll configure this separately based on AudioConfig
	};
}

/**
 * Get user media constraints for microphone
 */
export function getUserMediaConstraints(): MediaStreamConstraints {
	return {
		audio: {
			echoCancellation: true,
			noiseSuppression: true,
			sampleRate: 48000,
			channelCount: 2,
		},
	};
}

/**
 * Check if simulcast is supported by the browser
 */
export function isSimulcastSupported(): boolean {
	const pc = new RTCPeerConnection();
	const sender = pc.addTransceiver("video").sender;
	const params = sender.getParameters();
	pc.close();
	return "encodings" in params;
}
