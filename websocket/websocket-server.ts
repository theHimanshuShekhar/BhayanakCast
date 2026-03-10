import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env files FIRST before any other imports (from parent directory)
config({ path: join(__dirname, "..", ".env.local"), override: true });
config({ path: join(__dirname, "..", ".env"), override: true });

import { Server } from "socket.io";
import { createServer } from "http";
import {
	addParticipant,
	removeParticipant,
	updateAllRoomStatusesFromPresence,
	getRoomParticipants,
	getRoom,
	transferStreamer,
	runRoomCleanupJob,
} from "./websocket-room-manager";

// Debug: Log environment variables
console.log("[WebSocket Server] DATABASE_URL:", process.env.DATABASE_URL ? "Set" : "Not set");
console.log("[WebSocket Server] VITE_WS_URL:", process.env.VITE_WS_URL);

// Parse port from VITE_WS_URL (e.g., "http://localhost:3001" -> 3001)
const WS_URL = process.env.VITE_WS_URL || "http://localhost:3001";
const PORT = parseInt(new URL(WS_URL).port) || 3001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// Create HTTP server
const httpServer = createServer((req, res) => {
	res.setHeader("Access-Control-Allow-Origin", CLIENT_URL);
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	if (req.method === "OPTIONS") {
		res.writeHead(200);
		res.end();
		return;
	}

	// Handle root path - show simple HTML page
	if (req.url === "/" && req.method === "GET") {
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BhayanakCast WebSocket Server</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1b1e 0%, #2d2f36 100%);
            color: #ffffff;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            max-width: 500px;
        }
        h1 {
            margin: 0 0 1rem 0;
            font-size: 2rem;
            background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        p {
            margin: 0.5rem 0;
            color: #9ca3af;
            line-height: 1.6;
        }
        .status {
            display: inline-block;
            padding: 0.5rem 1rem;
            background: rgba(34, 197, 94, 0.2);
            color: #22c55e;
            border-radius: 20px;
            font-size: 0.875rem;
            margin-top: 1rem;
            border: 1px solid rgba(34, 197, 94, 0.3);
        }
        .dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: #22c55e;
            border-radius: 50%;
            margin-right: 0.5rem;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        a {
            color: #8b5cf6;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>BhayanakCast</h1>
        <p><strong>WebSocket Server</strong></p>
        <p>This is the WebSocket server for BhayanakCast real-time streaming platform.</p>
        <p>Port: ${PORT}</p>
        <div class="status"><span class="dot"></span>Server Running</div>
        <p style="margin-top: 1.5rem; font-size: 0.875rem;">
            Visit the main app at <a href="${CLIENT_URL}">${CLIENT_URL}</a>
        </p>
    </div>
</body>
</html>`);
		return;
	}

	// Handle broadcast endpoint for server functions
	if (req.url === "/api/broadcast" && req.method === "POST") {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk.toString();
		});
		req.on("end", () => {
			try {
				const { roomId, event, data } = JSON.parse(body);
				console.log(`[Broadcast] Broadcasting ${event} to room ${roomId}`);
				io.to(roomId).emit(event, data);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: true }));
			} catch (error) {
				console.error("[Broadcast] Error parsing request:", error);
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Invalid request" }));
			}
		});
		return;
	}

	res.writeHead(404);
	res.end("Not Found");
});

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

// Track socket -> user mapping for presence
const socketUserMap = new Map<string, { userId: string; userName: string; roomId?: string }>();

// Track unique users and their connection count for global user count
const connectedUsers = new Map<string, number>();

// Broadcast user count to all connected clients
function broadcastUserCount() {
	const count = connectedUsers.size;
	console.log(`[WebSocket] Broadcasting user count: ${count}`);
	io.emit("userCount", { count });
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

// Broadcast to all clients in a room (including sender)
function broadcastToRoom(roomId: string, event: string, data: unknown) {
	io.to(roomId).emit(event, data);
}

// Broadcast to all clients in a room except sender
function broadcastToRoomExceptSender(socket: any, roomId: string, event: string, data: unknown) {
	socket.to(roomId).emit(event, data);
}

// Send system message to room
function sendSystemMessage(roomId: string, content: string) {
	const message: ChatMessage = {
		id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
		roomId,
		userId: "system",
		userName: "System",
		content,
		timestamp: Date.now(),
		type: "system",
	};
	broadcastToRoom(roomId, "chat:message", message);
}

// Socket.io connection handler
io.on("connection", (socket) => {
	console.log(`[Socket.io] Client connected: ${socket.id}`);

	// Send current user count on connection
	socket.emit("userCount", { count: connectedUsers.size });

	// Handle user identification
	socket.on("identify", (data: { userId?: string; userName?: string; userImage?: string | null }) => {
		const userId = data.userId || `anonymous:${socket.id}`;
		const userName = data.userName || userId;
		
		socket.data.userId = userId;
		socket.data.userName = userName;
		socket.data.userImage = data.userImage;
		
		socketUserMap.set(socket.id, { userId, userName });
		
		// Increment connection count for this user
		const currentCount = connectedUsers.get(userId) || 0;
		connectedUsers.set(userId, currentCount + 1);
		// Only broadcast if this is the first connection for this user
		if (currentCount === 0) {
			broadcastUserCount();
		}
		
		console.log(`[Socket.io] User identified: ${userName} (${userId}) (socket: ${socket.id})`);
		socket.emit("identified", { userId, userName });
	});

	// Handle room join
	socket.on("room:join", async (data: { roomId: string }) => {
		const { roomId } = data;
		const userId = socket.data.userId;
		const userName = socket.data.userName || userId;

		if (!userId) {
			socket.emit("room:error", { message: "Not authenticated" });
			return;
		}

		// Check if already in this room
		const currentRoom = socketUserMap.get(socket.id)?.roomId;
		if (currentRoom === roomId) {
			socket.emit("room:joined", { roomId, alreadyInRoom: true });
			return;
		}

		// Leave current room if any
		if (currentRoom) {
			console.log(`[Room] User ${userId} leaving previous room ${currentRoom}`);
			socket.leave(currentRoom);
			const result = await removeParticipant(currentRoom, userId);
			const participants = await getRoomParticipants(currentRoom);
			
			// Notify others in old room
			broadcastToRoom(currentRoom, "room:user_left", {
				userId,
				userName,
				participantCount: participants.length,
			});
			sendSystemMessage(currentRoom, `${userName} left the room`);

			if (result.newStreamerId) {
				const newStreamerName = result.newStreamerName || "Someone";
				broadcastToRoom(currentRoom, "room:streamer_changed", {
					newStreamerId: result.newStreamerId,
					newStreamerName,
				});
				sendSystemMessage(currentRoom, `${newStreamerName} is now the streamer`);
			}
		}

		try {
			console.log(`[Room] User ${userId} joining room ${roomId}`);

			// Update database
			const result = await addParticipant(roomId, userId);

			// Join Socket.io room
			socket.join(roomId);
			socketUserMap.set(socket.id, { userId, userName, roomId });

			// Get updated participants
			const participants = await getRoomParticipants(roomId);
			const room = await getRoom(roomId);

			// Send room state to joining user
			socket.emit("room:joined", {
				roomId,
				participantCount: participants.length,
				participants,
				isStreamer: room?.streamerId === userId,
				becameStreamer: result.becameStreamer,
				status: room?.status,
			});

			// Notify others in room (exclude sender)
			broadcastToRoomExceptSender(socket, roomId, "room:user_joined", {
				userId,
				userName,
				participantCount: participants.length,
			});

			// Send system message to room
			sendSystemMessage(roomId, `${userName} joined the room`);

			// If user became streamer
			if (result.becameStreamer) {
				broadcastToRoom(roomId, "room:streamer_changed", {
					newStreamerId: userId,
					newStreamerName: userName,
				});
				sendSystemMessage(roomId, `${userName} is now the streamer`);
			}

			// If room status changed
			if (result.newStatus) {
				broadcastToRoom(roomId, "room:status_changed", { status: result.newStatus });
				
				const statusMessages: Record<string, string> = {
					waiting: "Room is now waiting for participants",
					preparing: "Room is preparing for stream",
					active: "Stream is now live!",
					ended: "Room has ended",
				};
				if (statusMessages[result.newStatus]) {
					sendSystemMessage(roomId, statusMessages[result.newStatus]);
				}
			}

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
		const userName = socket.data.userName || userId;

		if (!userId) {
			socket.emit("room:error", { message: "Not authenticated" });
			return;
		}

		try {
			console.log(`[Room] User ${userId} leaving room ${roomId}`);

			// Update database
			const result = await removeParticipant(roomId, userId);

			// Leave Socket.io room
			socket.leave(roomId);
			
			// Update socket user map
			const socketData = socketUserMap.get(socket.id);
			if (socketData) {
				socketUserMap.set(socket.id, { userId, userName });
			}

			// Get updated participants
			const participants = await getRoomParticipants(roomId);

			// Confirm leave to user
			socket.emit("room:left", { roomId, participantCount: participants.length });

			// Notify others in room
			broadcastToRoom(roomId, "room:user_left", {
				userId,
				userName,
				participantCount: participants.length,
			});

			// Send system message
			sendSystemMessage(roomId, `${userName} left the room`);

			// If streamer changed
			if (result.newStreamerId) {
				const newStreamerName = result.newStreamerName || "Someone";
				broadcastToRoom(roomId, "room:streamer_changed", {
					newStreamerId: result.newStreamerId,
					newStreamerName,
				});
				sendSystemMessage(roomId, `${newStreamerName} is now the streamer`);
			}

			// If room status changed
			if (result.newStatus) {
				broadcastToRoom(roomId, "room:status_changed", { status: result.newStatus });
				
				const statusMessages: Record<string, string> = {
					waiting: "Room is now waiting for participants",
					preparing: "Room is preparing for stream",
					active: "Stream is now live!",
					ended: "Room has ended",
				};
				if (statusMessages[result.newStatus]) {
					sendSystemMessage(roomId, statusMessages[result.newStatus]);
				}
			}

			console.log(`[Room] User ${userId} left room ${roomId} (${participants.length} participants)`);
		} catch (error) {
			console.error(`[Room] Error leaving room:`, error);
			socket.emit("room:error", { message: error instanceof Error ? error.message : "Failed to leave room" });
		}
	});

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
			content: content.trim(),
			timestamp: Date.now(),
			type: "user",
		};

		console.log(`[Chat] Message from ${userName} in room ${roomId}: ${content}`);
		
		// Broadcast to all in room (including sender)
		broadcastToRoom(roomId, "chat:message", message);
	});

	// Handle streamer transfer
	socket.on("streamer:transfer", async (data: { roomId: string; newStreamerId: string }) => {
		const { roomId, newStreamerId } = data;
		const userId = socket.data.userId;

		if (!userId) {
			socket.emit("room:error", { message: "Not authenticated" });
			return;
		}

		try {
			console.log(`[Room] User ${userId} transferring streamer to ${newStreamerId} in room ${roomId}`);

			// Update database
			const result = await transferStreamer(roomId, userId, newStreamerId);

			if (!result.success) {
				socket.emit("room:error", { message: result.error || "Failed to transfer streamer" });
				return;
			}

			// Notify all in room
			broadcastToRoom(roomId, "room:streamer_changed", {
				newStreamerId,
				newStreamerName: result.newStreamerName || "Someone",
			});

			sendSystemMessage(roomId, `${result.newStreamerName || "Someone"} is now the streamer`);

			// Confirm to sender
			socket.emit("streamer:transferred", { roomId, newStreamerId });

			console.log(`[Room] Streamer transferred in room ${roomId} to ${newStreamerId}`);
		} catch (error) {
			console.error(`[Room] Error transferring streamer:`, error);
			socket.emit("room:error", { message: error instanceof Error ? error.message : "Failed to transfer streamer" });
		}
	});

	// Handle disconnect
	socket.on("disconnect", async () => {
		const socketData = socketUserMap.get(socket.id);
		if (!socketData) return;

		const { userId, userName, roomId } = socketData;
		console.log(`[Socket.io] Client disconnected: ${socket.id} (user: ${userName})`);

		// If user was in a room, handle leave
		if (roomId) {
			try {
				const result = await removeParticipant(roomId, userId);
				const participants = await getRoomParticipants(roomId);

				// Notify others in room
				broadcastToRoom(roomId, "room:user_left", {
					userId,
					userName,
					participantCount: participants.length,
				});

				sendSystemMessage(roomId, `${userName} left the room`);

				if (result.newStreamerId) {
					const newStreamerName = result.newStreamerName || "Someone";
					broadcastToRoom(roomId, "room:streamer_changed", {
						newStreamerId: result.newStreamerId,
						newStreamerName,
					});
					sendSystemMessage(roomId, `${newStreamerName} is now the streamer`);
				}

				if (result.newStatus) {
					broadcastToRoom(roomId, "room:status_changed", { status: result.newStatus });
				}
			} catch (error) {
				console.error(`[Room] Error handling disconnect:`, error);
			}
		}

		// Remove from socket user map
		socketUserMap.delete(socket.id);
		
		// Decrement connection count for this user
		const currentCount = connectedUsers.get(userId) || 0;
		if (currentCount <= 1) {
			// Last connection - remove user and broadcast
			connectedUsers.delete(userId);
			broadcastUserCount();
		} else {
			// Still has other connections - just decrement
			connectedUsers.set(userId, currentCount - 1);
		}
	});
});

// Start server
httpServer.listen(PORT, async () => {
	console.log(`[Server] WebSocket server running on port ${PORT}`);

	// Run initial cleanup
	console.log("[RoomManager] Running initial cleanup on startup...");
	try {
		await updateAllRoomStatusesFromPresence();
	} catch (error) {
		console.error("[RoomManager] Error during initial cleanup:", error);
	}

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

	// Setup room cleanup job - runs every 5 minutes
	const CLEANUP_INTERVAL = 5 * 60 * 1000;
	console.log(`[RoomManager] Room cleanup scheduled every ${CLEANUP_INTERVAL / 1000 / 60} minutes`);

	setInterval(async () => {
		try {
			await runRoomCleanupJob((roomId) => {
				broadcastToRoom(roomId, "room:status_changed", { status: "ended" });
			});
		} catch (error) {
			console.error("[RoomManager] Error during room cleanup:", error);
		}
	}, CLEANUP_INTERVAL);
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
