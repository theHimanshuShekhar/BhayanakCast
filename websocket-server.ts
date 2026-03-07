import { Server } from "socket.io";
import { createServer } from "http";
import { config } from "dotenv";
import { runRoomCleanup } from "./src/utils/room-cleanup";
import { updateAllRoomStatuses } from "./src/utils/room-presence";

// Load environment variables from .env files
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env files from the project root
config({ path: join(__dirname, ".env.local"), override: true });
config({ path: join(__dirname, ".env"), override: true });

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

io.on("connection", (socket) => {
	// Handle user identification (called by client after connection)
	socket.on("identify", (data: { userId?: string }) => {
		const userId = data.userId || `anonymous:${socket.id}`;
		
		// Store user identification on the socket
		socket.data.userId = userId;
		
		// Add socket to user's set
		if (!userSockets.has(userId)) {
			userSockets.set(userId, new Set());
		}
		userSockets.get(userId)?.add(socket.id);
		
		broadcastUserCount();
	});

	// Send current user count to the new client
	socket.emit("userCount", { count: getUniqueUserCount() });

	// Room management
	socket.on("room:join", (data: { roomId: string }) => {
		const { roomId } = data;
		socket.join(roomId);
		
		// Broadcast to room that user joined
		socket.to(roomId).emit("room:join", {
			userId: socket.data.userId,
			socketId: socket.id,
		});
	});

	socket.on("room:leave", (data: { roomId: string }) => {
		const { roomId } = data;
		socket.leave(roomId);
		
		// Broadcast to room that user left
		socket.to(roomId).emit("room:leave", {
			userId: socket.data.userId,
			socketId: socket.id,
		});
	});

	// Handle ping/pong for connection health
	socket.on("ping", () => {
		socket.emit("pong");
	});

	// Handle disconnect
	socket.on("disconnect", () => {
		const userId = socket.data.userId;
		
		if (userId) {
			// Remove socket from user's set
			const sockets = userSockets.get(userId);
			if (sockets) {
				sockets.delete(socket.id);
				// If user has no more sockets, remove them entirely
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

// Room event broadcast helpers
export function broadcastRoomEvent(
	roomId: string,
	event: string,
	data: unknown,
) {
	io.to(roomId).emit(event, data);
}

export function broadcastStreamerChanged(
	roomId: string,
	newStreamerId: string,
) {
	broadcastRoomEvent(roomId, "room:streamer_changed", { newStreamerId });
}

export function broadcastRoomEnded(roomId: string) {
	broadcastRoomEvent(roomId, "room:ended", { roomId });
	// Kick all clients from the room
	io.in(roomId).socketsLeave(roomId);
}

// HTTP endpoint for room events (called by server functions)
httpServer.on("request", (req, res) => {
	// Enable CORS
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	if (req.method === "OPTIONS") {
		res.writeHead(200);
		res.end();
		return;
	}

	if (req.method === "POST" && req.url === "/api/broadcast") {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk.toString();
		});
		req.on("end", () => {
			try {
				const { roomId, event, data } = JSON.parse(body);
				broadcastRoomEvent(roomId, event, data);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: true }));
			} catch (error) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Invalid request" }));
			}
		});
	} else {
		res.writeHead(404);
		res.end();
	}
});

// Start server
httpServer.listen(PORT, async () => {
	console.log(`[Server] WebSocket server running on port ${PORT}`);
	
	// Run initial cleanup immediately
	console.log("[Room Cleanup] Running initial cleanup on startup...");
	try {
		await runRoomCleanup(broadcastRoomEnded);
	} catch (error) {
		console.error("[Room Cleanup] Error during initial cleanup:", error);
	}
	
	// Setup room cleanup job - runs every 5 minutes
	const CLEANUP_INTERVAL = 5 * 60 * 1000;
	console.log(`[Room Cleanup] Scheduled to run every ${CLEANUP_INTERVAL / 1000} seconds`);
	
	setInterval(async () => {
		console.log("[Room Cleanup] Running scheduled cleanup...");
		try {
			await runRoomCleanup(broadcastRoomEnded);
		} catch (error) {
			console.error("[Room Cleanup] Error during scheduled cleanup:", error);
		}
	}, CLEANUP_INTERVAL);
	
	// Setup presence update job - runs every 30 seconds
	const PRESENCE_INTERVAL = 30 * 1000;
	console.log(`[Presence] Scheduled to run every ${PRESENCE_INTERVAL / 1000} seconds`);
	
	// Run initial presence check
	console.log("[Presence] Running initial presence check on startup...");
	try {
		await updateAllRoomStatuses();
	} catch (error) {
		console.error("[Presence] Error during initial presence check:", error);
	}
	
	setInterval(async () => {
		try {
			await updateAllRoomStatuses();
		} catch (error) {
			console.error("[Presence] Error during presence check:", error);
		}
	}, PRESENCE_INTERVAL);
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
