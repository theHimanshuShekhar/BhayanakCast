/**
 * Streaming Event Handlers
 *
 * WebSocket event handlers for PeerJS streaming functionality.
 *
 * @module websocket/streaming/events
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { SocketUserData } from "../websocket-server";
import type {
	PeerJSReadyData,
	StreamerReadyData,
	ScreenShareEndedData,
	StreamerChangedData,
} from "./types";

// Extend Socket type
type TypedSocket = Socket & {
	data: SocketUserData;
};

// Track PeerJS IDs per room for streamer transfers
const roomPeerJSIds = new Map<string, Map<string, string>>(); // roomId -> userId -> peerId

/**
 * Setup streaming event handlers for a socket
 */
export function setupStreamingHandlers(
	io: SocketIOServer,
	socket: TypedSocket,
	socketUserMap: Map<string, SocketUserData>,
): void {
	// Track PeerJS IDs for users in rooms
	socket.on("peerjs:ready", (data: PeerJSReadyData) => {
		const { peerId } = data;
		const userId = socket.data.userId;

		console.log(`[PeerJS] User ${userId} ready with peer ID: ${peerId}`);

		// Store the PeerJS ID in socket data
		const socketData = socketUserMap.get(socket.id);
		if (socketData) {
			socketData.peerId = peerId;
			socketUserMap.set(socket.id, socketData);
		}
	});

	// Streamer ready to broadcast
	socket.on("peerjs:streamer_ready", (data: StreamerReadyData) => {
		const { roomId, peerId, audioConfig } = data;
		const userId = socket.data.userId;

		console.log(`[PeerJS] Streamer ${userId} ready in room ${roomId} with peer ID: ${peerId}`);

		// Update socket data with peer ID
		const socketData = socketUserMap.get(socket.id);
		if (socketData) {
			socketData.peerId = peerId;
			socketUserMap.set(socket.id, socketData);
		}

		// Track this peer ID for the room
		if (!roomPeerJSIds.has(roomId)) {
			roomPeerJSIds.set(roomId, new Map());
		}
		roomPeerJSIds.get(roomId)?.set(userId, peerId);

		// Notify all room members to connect to this streamer
		io.to(roomId).emit("peerjs:streamer_ready", {
			streamerPeerId: peerId,
			streamerName: socket.data.userName,
			audioConfig,
		});
	});

	// Screen sharing ended
	socket.on("peerjs:screen_share_ended", async (data: ScreenShareEndedData) => {
		const { roomId } = data;
		const userId = socket.data.userId;

		console.log(`[PeerJS] Screen share ended by ${userId} in room ${roomId}`);

		// Check in-memory state if user is streamer
		const { getRoomState } = await import("../room/state");
		const room = getRoomState(roomId);
		if (!room || room.streamerId !== userId) {
			return; // Not the streamer, ignore
		}

		// Streamer stopped streaming but stays in room
		// Status changes to preparing, but participant stays
		const { updateRoomStatus } = await import("../room/state");
		updateRoomStatus(roomId, "preparing");

		// Broadcast status change
		io.to(roomId).emit("room:status_changed", { status: "preparing" });
		io.to(roomId).emit("peerjs:screen_share_ended", { streamerId: userId });

		console.log(`[PeerJS] Screen share ended in room ${roomId}, status changed to preparing`);
	});
}

/**
 * Initiate streamer transfer - simplified for PeerJS
 * PeerJS handles reconnection automatically, so we just notify clients
 */
export async function initiateStreamerTransfer(
	io: SocketIOServer,
	roomId: string,
	newStreamerId: string,
	participants: Array<{ userId: string; userName: string }>,
): Promise<void> {
	console.log(`[PeerJS] Initiating streamer transfer in room ${roomId}`);

	// Get room's peer ID mapping
	const roomPeers = roomPeerJSIds.get(roomId);
	if (!roomPeers) return;

	// Find new streamer's peer ID
	const newStreamerPeerId = roomPeers.get(newStreamerId);
	if (!newStreamerPeerId) return;

	const newStreamerName = participants.find(p => p.userId === newStreamerId)?.userName || "Someone";

	// Notify all clients about the new streamer
	const data: StreamerChangedData = {
		newStreamerPeerId,
		newStreamerName,
	};
	io.to(roomId).emit("peerjs:streamer_changed", data);

	console.log(`[PeerJS] Streamer transfer notification sent for ${newStreamerName}`);
}

/**
 * Get peer ID for a user in a room
 */
export function getPeerIdForUser(roomId: string, userId: string): string | undefined {
	return roomPeerJSIds.get(roomId)?.get(userId);
}

/**
 * Remove peer ID tracking for a user
 */
export function removePeerId(roomId: string, userId: string): void {
	roomPeerJSIds.get(roomId)?.delete(userId);
	// Clean up empty room entries
	if (roomPeerJSIds.get(roomId)?.size === 0) {
		roomPeerJSIds.delete(roomId);
	}
}
