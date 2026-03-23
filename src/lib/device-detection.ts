/**
 * Device detection utilities for WebRTC streaming
 *
 * Detects mobile devices and WebRTC capabilities
 * Used to restrict streaming to desktop only
 */

export interface DeviceCapabilities {
	/** Whether the device is mobile (phone/tablet) */
	isMobile: boolean;
	/** Whether the device can stream (desktop with screen sharing support) */
	canStream: boolean;
	/** Whether the device can view streams */
	canView: boolean;
	/** Device type for analytics */
	deviceType: "mobile" | "tablet" | "desktop";
	/** User agent string */
	userAgent: string;
}

/**
 * Detect device capabilities and type
 */
export function detectDevice(): DeviceCapabilities {
	const userAgent = navigator.userAgent.toLowerCase();

	// Check for mobile devices
	const isMobile =
		/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
			userAgent,
		);

	// Check for tablets (iPad or Android tablets)
	const isTablet =
		/ipad/i.test(userAgent) ||
		(/android/i.test(userAgent) && !/mobile/i.test(userAgent));

	// Determine device type
	const deviceType: DeviceCapabilities["deviceType"] = isTablet
		? "tablet"
		: isMobile
			? "mobile"
			: "desktop";

	// Screen sharing is only supported on desktop
	// getDisplayMedia is not available on mobile browsers
	const canStream =
		!isMobile &&
		!isTablet &&
		"mediaDevices" in navigator &&
		"getDisplayMedia" in navigator.mediaDevices;

	// WebRTC viewing requires RTCPeerConnection
	const canView = "RTCPeerConnection" in window;

	return {
		isMobile: isMobile || isTablet,
		canStream,
		canView,
		deviceType,
		userAgent: navigator.userAgent,
	};
}

/**
 * Check if screen sharing is supported
 */
export function isScreenSharingSupported(): boolean {
	return (
		navigator.mediaDevices !== undefined &&
		navigator.mediaDevices !== null &&
		"getDisplayMedia" in navigator.mediaDevices
	);
}

/**
 * Check if device can view streams
 */
export function canViewStreams(): boolean {
	return "RTCPeerConnection" in window;
}

/**
 * Log device capabilities for debugging
 */
export function logDeviceCapabilities(): void {
	const caps = detectDevice();
	console.log("[Device Detection]", {
		deviceType: caps.deviceType,
		isMobile: caps.isMobile,
		canStream: caps.canStream,
		canView: caps.canView,
		userAgent: `${caps.userAgent.substring(0, 50)}...`,
	});
}
