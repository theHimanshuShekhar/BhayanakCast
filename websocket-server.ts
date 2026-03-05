import { Server } from "socket.io";
import { createServer } from "http";
import cron from "node-cron";
import { runRoomCleanup } from "./src/utils/room-cleanup";

const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 3001;
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
// For anonymous users, we use the socket.id as the userId
const userSockets = new Map<string, Set<string>>();

// Get unique user count
function getUniqueUserCount(): number {
	return userSockets.size;
}

// Broadcast user count to all connected clients
function broadcastUserCount() {
	const count = getUniqueUserCount();
	io.emit("userCount", { count });
	console.log(`[Socket.io] User count updated: ${count} unique users`);
}

io.on("connection", (socket) => {
	console.log(
		`[Socket.io] Client connected: ${socket.id}. Total connections: ${io.engine.clientsCount}`,
	);

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
		
		console.log(`[Socket.io] User identified: ${userId} (socket: ${socket.id})`);
		broadcastUserCount();
	});

	// Send current user count to the new client
	socket.emit("userCount", { count: getUniqueUserCount() });

	// Room management
	socket.on("room:join", (data: { roomId: string }) => {
		const { roomId } = data;
		socket.join(roomId);
		console.log(`[Socket.io] Socket ${socket.id} joined room: ${roomId}`);
		
		// Broadcast to room that user joined
		socket.to(roomId).emit("room:join", {
			userId: socket.data.userId,
			socketId: socket.id,
		});
	});

	socket.on("room:leave", (data: { roomId: string }) => {
		const { roomId } = data;
		socket.leave(roomId);
		console.log(`[Socket.io] Socket ${socket.id} left room: ${roomId}`);
		
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

	// Handle ping/pong for connection health
	socket.on("ping", () => {
		socket.emit("pong");
	});

	// Handle disconnect
	socket.on("disconnect", (reason) => {
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
		
		console.log(
			`[Socket.io] Client disconnected: ${socket.id}. Reason: ${reason}. User: ${userId || 'unknown'}`,
		);
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
	console.log(`[Socket.io] Broadcast ${event} to room ${roomId}`, data);
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
httpServer.listen(PORT, () => {
	console.log(`[Socket.io] Server started on port ${PORT}`);
	console.log(`[Socket.io] CORS enabled for: ${CLIENT_URL}`);

	// Setup room cleanup cron job - runs every 5 minutes
	cron.schedule("*/5 * * * *", async () => {
		console.log("[Cron] Running room cleanup job...");
		await runRoomCleanup(broadcastRoomEnded);
	});
	console.log("[Cron] Room cleanup scheduled every 5 minutes");
});

// Graceful shutdown
process.on("SIGTERM", () => {
	console.log("[Socket.io] SIGTERM received, closing server...");
	io.close(() => {
		httpServer.close(() => {
			console.log("[Socket.io] Server closed");
			process.exit(0);
		});
	});
});

process.on("SIGINT", () => {
	console.log("[Socket.io] SIGINT received, closing server...");
	io.close(() => {
		httpServer.close(() => {
			console.log("[Socket.io] Server closed");
			process.exit(0);
		});
	});
});
