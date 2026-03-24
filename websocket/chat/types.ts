/**
 * Chat Types
 *
 * Type definitions for chat functionality.
 *
 * @module websocket/chat/types
 */

/**
 * Chat message structure
 */
export interface ChatMessage {
	/** Unique message ID */
	id: string;
	/** Room ID */
	roomId: string;
	/** Sender user ID */
	userId: string;
	/** Sender display name */
	userName: string;
	/** Sender avatar URL */
	userImage?: string | null;
	/** Message content (filtered) */
	content: string;
	/** Unix timestamp */
	timestamp: number;
	/** Message type */
	type: "user" | "system";
}
