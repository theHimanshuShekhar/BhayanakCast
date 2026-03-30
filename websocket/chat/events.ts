/**
 * Chat Event Handlers
 *
 * WebSocket event handlers for chat functionality.
 *
 * @module websocket/chat/events
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import { censorText } from "../../src/lib/profanity-filter";
import { RateLimits, rateLimiter } from "../../src/lib/rate-limiter";
import type { SocketUserData } from "../websocket-server";
import type { ChatMessage } from "./types";

// Extend Socket type
type TypedSocket = Socket & {
	data: SocketUserData;
};

/**
 * Setup chat event handlers for a socket
 */
export function setupChatHandlers(
	io: SocketIOServer,
	socket: TypedSocket,
	socketUserMap: Map<string, SocketUserData>,
): void {
	// Handle chat messages
	socket.on("chat:send", (data: { roomId: string; content: string }) => {
		const { roomId, content } = data;
		const userId = socket.data.userId;
		const userName = socket.data.userName || userId;
		const userImage = socket.data.userImage;

		if (!userId) {
			socket.emit("chat:error", { message: "Not authenticated" });
			return;
		}

		if (!content || content.trim().length === 0) {
			socket.emit("chat:error", { message: "Message cannot be empty" });
			return;
		}

		// Check sustained rate limit (30 messages per 15 seconds)
		const chatLimiter = rateLimiter.forAction("chat:send");
		const rateLimitResult = chatLimiter.checkAndRecord(userId, RateLimits.CHAT_SEND);
		if (!rateLimitResult.allowed) {
			socket.emit("chat:error", {
				message: `You're sending messages too quickly. Try again in ${rateLimitResult.retryAfter} seconds.`,
				retryAfter: rateLimitResult.retryAfter,
			});
			return;
		}

		// Check rapid-fire rate limit (5 messages per 3 seconds) — catches micro-bursts
		const rapidLimiter = rateLimiter.forAction("chat:rapid");
		const rapidResult = rapidLimiter.checkAndRecord(userId, RateLimits.CHAT_RAPID);
		if (!rapidResult.allowed) {
			socket.emit("chat:error", {
				message: `Slow down! Try again in ${rapidResult.retryAfter} seconds.`,
				retryAfter: rapidResult.retryAfter,
			});
			return;
		}

		// Check if user is in the room
		const socketData = socketUserMap.get(socket.id);
		if (!socketData?.roomId || socketData.roomId !== roomId) {
			socket.emit("chat:error", { message: "You must join the room first" });
			return;
		}

		const message: ChatMessage = {
			id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			roomId,
			userId,
			userName,
			userImage,
			content: censorText(content.trim()),
			timestamp: Date.now(),
			type: "user",
		};

		console.log(`[Chat] Message from ${userName} in room ${roomId}: ${content}`);

		// Broadcast to all in room (including sender)
		io.to(roomId).emit("chat:message", message);
	});
}

/**
 * Send a system message to a room
 */
export function sendSystemMessage(
	io: SocketIOServer,
	roomId: string,
	content: string,
): void {
	const message: ChatMessage = {
		id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
		roomId,
		userId: "system",
		userName: "System",
		content,
		timestamp: Date.now(),
		type: "system",
	};
	io.to(roomId).emit("chat:message", message);
}

/**
 * Broadcast to all clients in a room (including sender)
 */
export function broadcastToRoom(
	io: SocketIOServer,
	roomId: string,
	event: string,
	data: unknown,
): void {
	io.to(roomId).emit(event, data);
}
