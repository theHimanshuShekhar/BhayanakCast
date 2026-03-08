import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env files FIRST before any other imports
config({ path: join(__dirname, ".env.local"), override: true });
config({ path: join(__dirname, ".env"), override: true });

import { Server } from "socket.io";
import { createServer } from "http";
import {
	addParticipant,
	removeParticipant,
	updateAllRoomStatusesFromPresence,
	trackSocketJoin,
	trackSocketLeave,
	getSocketRoomInfo,
	runRoomCleanupJob,
	getRoomParticipants,
	getRoom,
} from "./websocket-room-manager";

// Debug: Log environment variables
console.log("[WebSocket Server] DATABASE_URL:", process.env.DATABASE_URL ? "Set" : "Not set");
console.log("[WebSocket Server] VITE_WS_URL:", process.env.VITE_WS_URL);

// Parse port from VITE_WS_URL (e.g., "http://localhost:3001" -> 3001)
const WS_URL = process.env.VITE_WS_URL || "http://localhost:3001";
const PORT = parseInt(new URL(WS_URL).port) || 3001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// Create HTTP server
const httpServer = createServer();

// Create Socket.io server
const io = new Server(httpServer, {
	cors: {
		origin: CLIENT_URL,
		methods: ["GET", "POST"],
		credentials: true,
	},
	pingTimeout: 60000,
	pingInterval: 25000,
});

// Track unique users: userId -> Set of socket ids
const userSockets = new Map<string, Set<string>>();

// Get unique user count
function getUniqueUserCount(): number {
	return userSockets.size;
}

// Broadcast user count to all connected clients
function broadcastUserCount() {
	const count = getUniqueUserCount();
	io.emit("userCount", { count });
}

// Broadcast room events
function broadcastToRoom(roomId: string, event: string, data: unknown) {
	io.to(roomId).emit(event, data);
}

function broadcastRoomEnded(roomId: string) {
	broadcastToRoom(roomId, "room:ended", { roomId });
	io.in(roomId).socketsLeave(roomId);
}

function broadcastStreamerChanged(roomId: string, newStreamerId: string) {
	broadcastToRoom(roomId, "room:streamer_changed", { newStreamerId });
}

function broadcastParticipantJoined(roomId: string, userId: string, userName: string, participantCount: number) {
	broadcastToRoom(roomId, "room:participant_joined", { userId, userName, participantCount });
	
	// Send system message to chat
	const systemMessage: ChatMessage = {
		id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
		roomId,
		userId: "system",
		userName: "System",
		content: `${userName} joined the room`,
		timestamp: Date.now(),
		type: "system",
	};
	broadcastChatMessage(roomId, systemMessage);
}

function broadcastParticipantLeft(roomId: string, userId: string, userName: string, participantCount: number) {
	broadcastToRoom(roomId, "room:participant_left", { userId, userName, participantCount });
	
	// Send system message to chat
	const systemMessage: ChatMessage = {
		id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
		roomId,
		userId: "system",
		userName: "System",
		content: `${userName} left the room`,
		timestamp: Date.now(),
		type: "system",
	};
	broadcastChatMessage(roomId, systemMessage);
}

// Broadcast chat message to room
function broadcastChatMessage(roomId: string, message: ChatMessage) {
	broadcastToRoom(roomId, "chat:message", message);
}

// Chat message type
interface ChatMessage {
	id: string;
	roomId: string;
	userId: string;
	userName: string;
	userImage?: string | null;
	content: string;
	timestamp: number;
	type: "user" | "system";
}

// Socket.io connection handler
io.on("connection", (socket) => {
	console.log(`[Socket.io] Client connected: ${socket.id}`);

	// Handle user identification
	socket.on("identify", (data: { userId?: string; userName?: string; userImage?: string | null }) => {
		const userId = data.userId || `anonymous:${socket.id}`;
		const userName = data.userName || userId;
		socket.data.userId = userId;
		socket.data.userName = userName;
		socket.data.userImage = data.userImage;

		if (!userSockets.has(userId)) {
			userSockets.set(userId, new Set());
		}
		userSockets.get(userId)?.add(socket.id);

		console.log(`[Socket.io] User identified: ${userName} (${userId}) (socket: ${socket.id})`);
		broadcastUserCount();
	});

	// Send current user count
	socket.emit("userCount", { count: getUniqueUserCount() });

	// Handle room join
	socket.on("room:join", async (data: { roomId: string }) => {
		const { roomId } = data;
		const userId = socket.data.userId;

		if (!userId) {
			socket.emit("room:error", { message: "Not authenticated" });
			return;
		}

		try {
			console.log(`[Room] User ${userId} joining room ${roomId}`);

			// Add participant via room manager
			const result = await addParticipant(roomId, userId);

			// Join socket to room
			socket.join(roomId);
			trackSocketJoin(socket.id, roomId, userId);

			// Get updated participant count
			const participants = await getRoomParticipants(roomId);

			// Broadcast join to room
			broadcastParticipantJoined(roomId, userId, socket.data.userName || userId, participants.length);

			// If user became streamer, broadcast it
			if (result.becameStreamer) {
				console.log(`[Room] User ${userId} became streamer of room ${roomId}`);
				broadcastStreamerChanged(roomId, userId);
				
				// Send system message
				const systemMessage: ChatMessage = {
					id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
					roomId,
					userId: "system",
					userName: "System",
					content: `${socket.data.userName || userId} is now the streamer`,
					timestamp: Date.now(),
					type: "system",
				};
				broadcastChatMessage(roomId, systemMessage);
			}

			// If status changed, broadcast it
			if (result.newStatus) {
				broadcastToRoom(roomId, "room:status_changed", { status: result.newStatus });
				
				// Send system message for status change
				let statusMessage = "";
				switch (result.newStatus) {
					case "waiting":
						statusMessage = "Room is now waiting for participants";
						break;
					case "preparing":
						statusMessage = "Room is preparing for stream";
						break;
					case "active":
						statusMessage = "Stream is now live!";
						break;
					case "ended":
						statusMessage = "Room has ended";
						break;
					default:
						statusMessage = `Room status changed to ${result.newStatus}`;
				}
				
				const statusSystemMessage: ChatMessage = {
					id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
					roomId,
					userId: "system",
					userName: "System",
					content: statusMessage,
					timestamp: Date.now(),
					type: "system",
				};
				broadcastChatMessage(roomId, statusSystemMessage);
			}

			// Send room state to joining user
			const room = await getRoom(roomId);
			socket.emit("room:joined", {
				roomId,
				participantCount: participants.length,
				participants: participants.map((p) => ({
					userId: p.userId,
					joinedAt: p.joinedAt,
				})),
				isStreamer: room?.streamerId === userId,
				becameStreamer: result.becameStreamer,
			});

			console.log(`[Room] User ${userId} joined room ${roomId} (${participants.length} participants)`);
		} catch (error) {
			console.error(`[Room] Error joining room:`, error);
			socket.emit("room:error", { message: error instanceof Error ? error.message : "Failed to join room" });
		}
	});

	// Handle room leave
	socket.on("room:leave", async (data: { roomId: string }) => {
		const { roomId } = data;
		const userId = socket.data.userId;

		if (!userId) return;

		try {
			console.log(`[Room] User ${userId} leaving room ${roomId}`);

			// Remove participant via room manager
			const result = await removeParticipant(roomId, userId);

			// Leave socket room
			socket.leave(roomId);
			trackSocketLeave(socket.id);

			// Get updated participant count
			const participants = await getRoomParticipants(roomId);

			// Broadcast leave to room
			broadcastParticipantLeft(roomId, userId, socket.data.userName || userId, participants.length);

			// If streamer changed, broadcast it
			if (result.newStreamerId) {
				console.log(`[Room] Streamer changed in room ${roomId} to ${result.newStreamerId}`);
				broadcastStreamerChanged(roomId, result.newStreamerId);
				
				// Send system message
				const streamerMessage: ChatMessage = {
					id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
					roomId,
					userId: "system",
					userName: "System",
					content: `Streamer changed to a new host`,
					timestamp: Date.now(),
					type: "system",
				};
				broadcastChatMessage(roomId, streamerMessage);
			}

			// If room is empty, broadcast status change
			if (result.newStatus) {
				broadcastToRoom(roomId, "room:status_changed", { status: result.newStatus });
				
				// Send system message for status change
				let statusMsg = "";
				switch (result.newStatus) {
					case "waiting":
						statusMsg = "Room is now waiting for participants";
						break;
					case "ended":
						statusMsg = "Room has ended";
						break;
					default:
						statusMsg = `Room status changed to ${result.newStatus}`;
				}
				
				if (statusMsg) {
					const statusSystemMsg: ChatMessage = {
						id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
						roomId,
						userId: "system",
						userName: "System",
						content: statusMsg,
						timestamp: Date.now(),
						type: "system",
					};
					broadcastChatMessage(roomId, statusSystemMsg);
				}
			}

			socket.emit("room:left", { roomId, roomEmpty: result.roomEmpty });

			console.log(`[Room] User ${userId} left room ${roomId} (${participants.length} participants remaining)`);
		} catch (error) {
			console.error(`[Room] Error leaving room:`, error);
		}
	});

	// Handle chat messages
	socket.on("chat:send", (data: { roomId: string; content: string; userName: string; userImage?: string | null }) => {
		const { roomId, content, userName, userImage } = data;
		const userId = socket.data.userId;

		if (!userId) {
			socket.emit("chat:error", { message: "Not authenticated" });
			return;
		}

		if (!content || content.trim().length === 0) {
			socket.emit("chat:error", { message: "Message cannot be empty" });
			return;
		}

		// Check if user is in the room
		const roomInfo = getSocketRoomInfo(socket.id);
		if (!roomInfo || roomInfo.roomId !== roomId) {
			socket.emit("chat:error", { message: "You must join the room first" });
			return;
		}

		const message: ChatMessage = {
			id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			roomId,
			userId,
			userName,
			userImage,
			content: content.trim(),
			timestamp: Date.now(),
			type: "user",
		};

		console.log(`[Chat] Message from ${userName} in room ${roomId}: ${content}`);
		broadcastChatMessage(roomId, message);
	});

	// Handle disconnect
	socket.on("disconnect", async () => {
		const userId = socket.data.userId;
		console.log(`[Socket.io] Client disconnected: ${socket.id} (user: ${userId})`);

		// Check if user was in a room
		const roomInfo = getSocketRoomInfo(socket.id);
		if (roomInfo) {
			try {
				const result = await removeParticipant(roomInfo.roomId, roomInfo.userId);
				const participants = await getRoomParticipants(roomInfo.roomId);

				broadcastParticipantLeft(roomInfo.roomId, roomInfo.userId, "A user", participants.length);

				if (result.newStreamerId) {
					broadcastStreamerChanged(roomInfo.roomId, result.newStreamerId);
				}

				if (result.newStatus) {
					broadcastToRoom(roomInfo.roomId, "room:status_changed", { status: result.newStatus });
				}
			} catch (error) {
				console.error(`[Room] Error handling disconnect:`, error);
			}
		}

		// Remove from user tracking
		if (userId) {
			const sockets = userSockets.get(userId);
			if (sockets) {
				sockets.delete(socket.id);
				if (sockets.size === 0) {
					userSockets.delete(userId);
				}
			}
		}

		broadcastUserCount();
	});

	// Handle errors
	socket.on("error", (error: Error) => {
		console.error(`[Socket.io] Socket error for ${socket.id}:`, error);
	});
});

// Start server
httpServer.listen(PORT, async () => {
	console.log(`[Server] WebSocket server running on port ${PORT}`);

	// Run initial cleanup
	console.log("[RoomManager] Running initial cleanup on startup...");
	try {
		await runRoomCleanupJob(broadcastRoomEnded);
	} catch (error) {
		console.error("[RoomManager] Error during initial cleanup:", error);
	}

	// Run initial status update
	console.log("[RoomManager] Running initial status update...");
	try {
		await updateAllRoomStatusesFromPresence();
	} catch (error) {
		console.error("[RoomManager] Error during initial status update:", error);
	}

	// Setup cleanup job - runs every 5 minutes
	const CLEANUP_INTERVAL = 5 * 60 * 1000;
	console.log(`[RoomManager] Cleanup scheduled every ${CLEANUP_INTERVAL / 1000} seconds`);

	setInterval(async () => {
		console.log("[RoomManager] Running scheduled cleanup...");
		try {
			await runRoomCleanupJob(broadcastRoomEnded);
		} catch (error) {
			console.error("[RoomManager] Error during cleanup:", error);
		}
	}, CLEANUP_INTERVAL);

	// Setup status update job - runs every 1 minute
	const STATUS_INTERVAL = 60 * 1000;
	console.log(`[RoomManager] Status updates scheduled every ${STATUS_INTERVAL / 1000} seconds`);

	setInterval(async () => {
		try {
			await updateAllRoomStatusesFromPresence();
		} catch (error) {
			console.error("[RoomManager] Error during status update:", error);
		}
	}, STATUS_INTERVAL);
});

// Graceful shutdown
process.on("SIGTERM", () => {
	io.close(() => {
		httpServer.close(() => {
			process.exit(0);
		});
	});
});

process.on("SIGINT", () => {
	io.close(() => {
		httpServer.close(() => {
			process.exit(0);
		});
	});
});
