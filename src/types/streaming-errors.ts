/**
 * Streaming Error Types
 *
 * Typed error definitions for PeerJS streaming failures.
 *
 * @module types/streaming-errors
 */

export enum StreamingErrorType {
	PEER_INIT_FAILED = "peer_init_failed",
	SCREEN_CAPTURE_DENIED = "screen_capture_denied",
	SCREEN_CAPTURE_FAILED = "screen_capture_failed",
	CONNECTION_FAILED = "connection_failed",
	CONNECTION_LOST = "connection_lost",
	CONNECTION_TIMEOUT = "connection_timeout",
	STREAMER_TRANSFER_FAILED = "transfer_failed",
	STREAM_ENDED_UNEXPECTEDLY = "stream_ended",
	PEERJS_ERROR = "peerjs_error",
	UNKNOWN = "unknown",
}

export interface StreamingError {
	type: StreamingErrorType;
	message: string;
	recoverable: boolean;
	timestamp: number;
}

/**
 * Create a StreamingError with the current timestamp.
 */
export function createStreamingError(
	type: StreamingErrorType,
	message: string,
	recoverable: boolean,
): StreamingError {
	return { type, message, recoverable, timestamp: Date.now() };
}
