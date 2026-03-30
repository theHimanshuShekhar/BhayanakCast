/**
 * Streaming Errors Unit Tests
 */

import { describe, expect, it } from "vitest";
import {
	StreamingErrorType,
	createStreamingError,
	type StreamingError,
} from "../../../src/types/streaming-errors";
import {
	streamingErrorMessages,
	getStreamingErrorMessage,
} from "../../../src/lib/streaming-error-messages";

describe("StreamingErrorType", () => {
	it("has all required error types", () => {
		const types = Object.values(StreamingErrorType);
		expect(types).toContain("peer_init_failed");
		expect(types).toContain("screen_capture_denied");
		expect(types).toContain("screen_capture_failed");
		expect(types).toContain("connection_failed");
		expect(types).toContain("connection_lost");
		expect(types).toContain("connection_timeout");
		expect(types).toContain("transfer_failed");
		expect(types).toContain("stream_ended");
		expect(types).toContain("peerjs_error");
		expect(types).toContain("unknown");
	});
});

describe("createStreamingError", () => {
	it("creates an error with the correct fields", () => {
		const before = Date.now();
		const err = createStreamingError(
			StreamingErrorType.CONNECTION_FAILED,
			"Could not connect",
			true,
		);
		const after = Date.now();

		expect(err.type).toBe(StreamingErrorType.CONNECTION_FAILED);
		expect(err.message).toBe("Could not connect");
		expect(err.recoverable).toBe(true);
		expect(err.timestamp).toBeGreaterThanOrEqual(before);
		expect(err.timestamp).toBeLessThanOrEqual(after);
	});

	it("marks non-recoverable errors correctly", () => {
		const err = createStreamingError(
			StreamingErrorType.SCREEN_CAPTURE_DENIED,
			"Permission denied",
			false,
		);
		expect(err.recoverable).toBe(false);
	});
});

describe("streamingErrorMessages", () => {
	it("has a message for every StreamingErrorType", () => {
		for (const type of Object.values(StreamingErrorType)) {
			expect(streamingErrorMessages[type]).toBeDefined();
			expect(typeof streamingErrorMessages[type]).toBe("string");
			expect(streamingErrorMessages[type].length).toBeGreaterThan(0);
		}
	});

	it("messages are user-friendly strings", () => {
		expect(streamingErrorMessages[StreamingErrorType.CONNECTION_FAILED]).toContain(
			"connect",
		);
		expect(streamingErrorMessages[StreamingErrorType.SCREEN_CAPTURE_DENIED]).toContain(
			"Screen sharing",
		);
		expect(streamingErrorMessages[StreamingErrorType.PEERJS_ERROR]).toContain(
			"Reconnecting",
		);
	});
});

describe("getStreamingErrorMessage", () => {
	it("returns the correct message for a known type", () => {
		const msg = getStreamingErrorMessage(StreamingErrorType.CONNECTION_LOST);
		expect(msg).toBe(streamingErrorMessages[StreamingErrorType.CONNECTION_LOST]);
	});

	it("returns UNKNOWN message as fallback for unmapped types", () => {
		// Force an invalid type to test fallback
		const msg = getStreamingErrorMessage("invalid_type" as StreamingErrorType);
		expect(msg).toBe(streamingErrorMessages[StreamingErrorType.UNKNOWN]);
	});
});

describe("StreamingError interface", () => {
	it("satisfies the expected shape", () => {
		const err: StreamingError = {
			type: StreamingErrorType.UNKNOWN,
			message: "test",
			recoverable: true,
			timestamp: Date.now(),
		};
		expect(err).toBeDefined();
	});
});
