/**
 * Streaming Error Messages
 *
 * User-friendly messages for each streaming error type.
 *
 * @module lib/streaming-error-messages
 */

import { StreamingErrorType } from "#/types/streaming-errors";

export const streamingErrorMessages: Record<StreamingErrorType, string> = {
	[StreamingErrorType.PEER_INIT_FAILED]:
		"Failed to initialize streaming service. Please refresh and try again.",
	[StreamingErrorType.SCREEN_CAPTURE_DENIED]:
		"Screen sharing was cancelled. Click 'Start Streaming' to try again.",
	[StreamingErrorType.SCREEN_CAPTURE_FAILED]:
		"Failed to capture screen. Please check your permissions and try again.",
	[StreamingErrorType.CONNECTION_FAILED]:
		"Failed to connect to stream. Retrying...",
	[StreamingErrorType.CONNECTION_LOST]:
		"Connection lost. Attempting to reconnect...",
	[StreamingErrorType.CONNECTION_TIMEOUT]:
		"Connection timed out. Checking network...",
	[StreamingErrorType.STREAMER_TRANSFER_FAILED]:
		"Failed to switch to new streamer. Waiting for stream...",
	[StreamingErrorType.STREAM_ENDED_UNEXPECTEDLY]:
		"Stream ended unexpectedly. Waiting for it to resume...",
	[StreamingErrorType.PEERJS_ERROR]:
		"Streaming service error. Reconnecting...",
	[StreamingErrorType.UNKNOWN]:
		"An unexpected error occurred. Retrying...",
};

/**
 * Get a user-friendly message for a streaming error type.
 */
export function getStreamingErrorMessage(type: StreamingErrorType): string {
	return streamingErrorMessages[type] ?? streamingErrorMessages[StreamingErrorType.UNKNOWN];
}
