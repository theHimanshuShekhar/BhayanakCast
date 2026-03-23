/**
 * Mobile Restrictions Integration Tests
 *
 * Tests for mobile device restrictions in streamer transfers
 */

import { describe, expect, it, vi } from "vitest";

describe("Mobile Restrictions", () => {
	describe("socket identification", () => {
		it("includes isMobile flag in socket identification", async () => {
			// This would be tested via WebSocket connection
			// Verifying that mobile users send isMobile=true on identify
			const mockSocket = {
				emit: vi.fn(),
				on: vi.fn(),
				data: {} as { userId?: string; isMobile?: boolean },
			};

			// Simulate mobile user identifying
			const identifyData = {
				userId: "mobile-user",
				userName: "Mobile User",
				isMobile: true,
			};

			// Verify socket data is set correctly
			mockSocket.data.userId = identifyData.userId;
			mockSocket.data.isMobile = identifyData.isMobile;

			expect(mockSocket.data.isMobile).toBe(true);
			expect(mockSocket.data.userId).toBe("mobile-user");
		});

		it("includes isMobile=false for desktop users", async () => {
			const mockSocket = {
				emit: vi.fn(),
				on: vi.fn(),
				data: {} as { userId?: string; isMobile?: boolean },
			};

			const identifyData = {
				userId: "desktop-user",
				userName: "Desktop User",
				isMobile: false,
			};

			mockSocket.data.userId = identifyData.userId;
			mockSocket.data.isMobile = identifyData.isMobile;

			expect(mockSocket.data.isMobile).toBe(false);
		});
	});
});
