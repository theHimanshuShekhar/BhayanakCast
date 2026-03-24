/**
 * Streaming Types
 *
 * Type definitions for PeerJS streaming functionality.
 *
 * @module websocket/streaming/types
 */

/**
 * PeerJS ready event data
 */
export interface PeerJSReadyData {
	/** PeerJS peer ID */
	peerId: string;
}

/**
 * Streamer ready event data
 */
export interface StreamerReadyData {
	/** Room ID */
	roomId: string;
	/** PeerJS peer ID */
	peerId: string;
	/** Audio configuration */
	audioConfig: string;
}

/**
 * Screen share ended event data
 */
export interface ScreenShareEndedData {
	/** Room ID */
	roomId: string;
}

/**
 * Streamer changed event data (outgoing)
 */
export interface StreamerChangedData {
	/** New streamer's PeerJS peer ID */
	newStreamerPeerId: string;
	/** New streamer's name */
	newStreamerName: string;
}
