/**
 * Device Detection Unit Tests
 *
 * Tests for mobile/desktop detection and WebRTC capabilities
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	detectDevice,
	isScreenSharingSupported,
	canViewStreams,
	logDeviceCapabilities,
} from "#/lib/device-detection";

	describe("Device Detection", () => {
	let originalNavigator: Navigator;

	beforeEach(() => {
		originalNavigator = globalThis.navigator;

		// Reset mocks
		vi.clearAllMocks();
	});

	afterEach(() => {
		// Restore original navigator
		Object.defineProperty(globalThis, "navigator", {
			value: originalNavigator,
			writable: true,
			configurable: true,
		});
	});

	const setUserAgent = (ua: string) => {
		Object.defineProperty(globalThis, "navigator", {
			value: {
				...originalNavigator,
				userAgent: ua,
			},
			writable: true,
			configurable: true,
		});
	};

	const mockMediaDevices = (hasGetDisplayMedia = true) => {
		const mediaDevices = hasGetDisplayMedia
			? {
					getDisplayMedia: vi.fn(),
					getUserMedia: vi.fn(),
			  }
			: {
					getUserMedia: vi.fn(),
			  };

		Object.defineProperty(globalThis.navigator, "mediaDevices", {
			value: mediaDevices,
			writable: true,
			configurable: true,
		});
	};

	const mockRTCPeerConnection = (exists = true) => {
		if (exists) {
			globalThis.RTCPeerConnection = vi.fn() as unknown as typeof RTCPeerConnection;
		} else {
			// @ts-expect-error - removing for test
			delete globalThis.RTCPeerConnection;
		}
	};

	describe("Mobile Device Detection", () => {
		it("detects iPhone as mobile", () => {
			setUserAgent(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
			);
			mockMediaDevices(false);
			mockRTCPeerConnection();

			const result = detectDevice();

			expect(result.isMobile).toBe(true);
			expect(result.deviceType).toBe("mobile");
			expect(result.canStream).toBe(false);
			expect(result.canView).toBe(true);
		});

		it("detects Android phone as mobile", () => {
			setUserAgent(
				"Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
			);
			mockMediaDevices(false);
			mockRTCPeerConnection();

			const result = detectDevice();

			expect(result.isMobile).toBe(true);
			expect(result.deviceType).toBe("mobile");
			expect(result.canStream).toBe(false);
		});

		it("detects iPad as tablet", () => {
			setUserAgent(
				"Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
			);
			mockMediaDevices(false);
			mockRTCPeerConnection();

			const result = detectDevice();

			expect(result.isMobile).toBe(true);
			expect(result.deviceType).toBe("tablet");
			expect(result.canStream).toBe(false);
		});

		it("detects Android tablet as tablet", () => {
			setUserAgent(
				"Mozilla/5.0 (Linux; Android 13; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
			);
			mockMediaDevices(false);
			mockRTCPeerConnection();

			const result = detectDevice();

			expect(result.isMobile).toBe(true);
			expect(result.deviceType).toBe("tablet");
			expect(result.canStream).toBe(false);
		});
	});

	describe("Desktop Device Detection", () => {
		it("detects Chrome on desktop", () => {
			setUserAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
			);
			mockMediaDevices(true);
			mockRTCPeerConnection();

			const result = detectDevice();

			expect(result.isMobile).toBe(false);
			expect(result.deviceType).toBe("desktop");
			expect(result.canStream).toBe(true);
			expect(result.canView).toBe(true);
		});

		it("detects Firefox on desktop", () => {
			setUserAgent(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/112.0",
			);
			mockMediaDevices(true);
			mockRTCPeerConnection();

			const result = detectDevice();

			expect(result.isMobile).toBe(false);
			expect(result.deviceType).toBe("desktop");
			expect(result.canStream).toBe(true);
			expect(result.canView).toBe(true);
		});

		it("detects Safari on desktop", () => {
			setUserAgent(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
			);
			mockMediaDevices(true);
			mockRTCPeerConnection();

			const result = detectDevice();

			expect(result.isMobile).toBe(false);
			expect(result.deviceType).toBe("desktop");
			expect(result.canStream).toBe(true);
			expect(result.canView).toBe(true);
		});
	});

	describe("Screen Sharing Support", () => {
		it("returns true when getDisplayMedia is available", () => {
			mockMediaDevices(true);

			expect(isScreenSharingSupported()).toBe(true);
		});

		it("returns false when getDisplayMedia is not available", () => {
			mockMediaDevices(false);

			expect(isScreenSharingSupported()).toBe(false);
		});

		it("returns false when mediaDevices is not available", () => {
			Object.defineProperty(globalThis.navigator, "mediaDevices", {
				value: undefined,
				writable: true,
				configurable: true,
			});

			expect(isScreenSharingSupported()).toBe(false);
		});
	});

	describe("Stream Viewing Support", () => {
		it("returns true when RTCPeerConnection is available", () => {
			mockRTCPeerConnection(true);

			expect(canViewStreams()).toBe(true);
		});

		it("returns false when RTCPeerConnection is not available", () => {
			mockRTCPeerConnection(false);

			expect(canViewStreams()).toBe(false);
		});
	});

	describe("Edge Cases", () => {
		it("handles empty user agent", () => {
			setUserAgent("");
			mockMediaDevices(true);
			mockRTCPeerConnection();

			const result = detectDevice();

			// Should default to desktop when can't detect
			expect(result.deviceType).toBe("desktop");
			expect(result.canStream).toBe(true);
		});

		it("handles unusual user agents", () => {
			setUserAgent("CustomBot/1.0");
			mockMediaDevices(true);
			mockRTCPeerConnection();

			const result = detectDevice();

			// Should default to desktop for unknown agents
			expect(result.deviceType).toBe("desktop");
		});

		it("correctly stores user agent in result", () => {
			const testUA = "Mozilla/5.0 (Test)";
			setUserAgent(testUA);
			mockMediaDevices(true);
			mockRTCPeerConnection();

			const result = detectDevice();

			expect(result.userAgent).toBe(testUA);
		});
	});

	describe("Logging", () => {
		it("logs device capabilities without errors", () => {
			setUserAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
			);
			mockMediaDevices(true);
			mockRTCPeerConnection();

			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			logDeviceCapabilities();

			expect(consoleSpy).toHaveBeenCalled();
			expect(consoleSpy).toHaveBeenCalledWith(
				"[Device Detection]",
				expect.objectContaining({
					deviceType: expect.any(String),
					isMobile: expect.any(Boolean),
					canStream: expect.any(Boolean),
					canView: expect.any(Boolean),
					userAgent: expect.any(String),
				}),
			);

			consoleSpy.mockRestore();
		});
	});
});
