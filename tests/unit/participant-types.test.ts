import { describe, expect, it } from "vitest";
import type { RoomParticipant } from "#/hooks/useRoom";
import type { SerializedParticipant } from "../../websocket/room-state";

describe("Participant Type Safety", () => {
	describe("RoomParticipant and SerializedParticipant compatibility", () => {
		it("should have matching types for all shared properties", () => {
			// This test ensures the types between frontend and WebSocket are compatible
			// If this test fails at compile time, the types are out of sync

			const webSocketParticipant: SerializedParticipant = {
				userId: "user-123",
				userName: "Test User",
				userImage: null,
				joinedAt: new Date(),
				isMobile: false,
				totalTimeSeconds: 3600,
			};

			// Should be assignable to RoomParticipant (same structure)
			const roomParticipant: RoomParticipant = webSocketParticipant;

			expect(roomParticipant.userId).toBe("user-123");
			expect(roomParticipant.totalTimeSeconds).toBe(3600);
		});

		it("should require totalTimeSeconds in both types", () => {
			// totalTimeSeconds was missing in the WebSocket type causing runtime errors
			const participant: SerializedParticipant = {
				userId: "user-123",
				userName: "Test",
				userImage: null,
				joinedAt: new Date(),
				isMobile: false,
				totalTimeSeconds: 0, // Required field
			};

			expect(typeof participant.totalTimeSeconds).toBe("number");
		});

		it("should handle null userImage consistently", () => {
			// userImage should be string | null, not string | undefined
			const wsParticipant: SerializedParticipant = {
				userId: "user-123",
				userName: "Test",
				userImage: null,
				joinedAt: new Date(),
				isMobile: false,
				totalTimeSeconds: 0,
			};

			const roomParticipant: RoomParticipant = {
				userId: "user-123",
				userName: "Test",
				userImage: null,
				joinedAt: new Date(),
				isMobile: false,
				totalTimeSeconds: 0,
			};

			// Both should accept null
			expect(wsParticipant.userImage).toBeNull();
			expect(roomParticipant.userImage).toBeNull();
		});
	});

	describe("Type structure validation", () => {
		it("should have flat structure (not nested)", () => {
			// Regression test: Previously the code had p.participant.totalTimeSeconds
			// which assumed a nested structure that didn't exist
			const participant: SerializedParticipant = {
				userId: "user-123",
				userName: "Test",
				userImage: null,
				joinedAt: new Date(),
				isMobile: false,
				totalTimeSeconds: 3600,
			};

			// These should all be direct properties, not nested
			expect("userId" in participant).toBe(true);
			expect("userName" in participant).toBe(true);
			expect("userImage" in participant).toBe(true);
			expect("joinedAt" in participant).toBe(true);
			expect("isMobile" in participant).toBe(true);
			expect("totalTimeSeconds" in participant).toBe(true);

			// Should not have a nested 'participant' property
			expect("participant" in participant).toBe(false);
		});

		it("should have all required properties defined", () => {
			const participant: RoomParticipant = {
				userId: "user-123",
				userName: "Test",
				userImage: null,
				joinedAt: new Date(),
				isMobile: false,
				totalTimeSeconds: 3600,
			};

			// Verify all properties are defined
			expect(participant.userId).toBeDefined();
			expect(participant.userName).toBeDefined();
			expect(participant.joinedAt).toBeDefined();
			expect(participant.isMobile).toBeDefined();
			expect(participant.totalTimeSeconds).toBeDefined();
		});
	});
});
