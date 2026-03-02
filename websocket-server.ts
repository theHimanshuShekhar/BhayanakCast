import { Server } from "socket.io";
import { createServer } from "http";

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

// Broadcast user count to all connected clients
function broadcastUserCount() {
	const count = io.engine.clientsCount;
	io.emit("userCount", { count });
	console.log(`[Socket.io] User count updated: ${count} connected clients`);
}

io.on("connection", (socket) => {
	console.log(
		`[Socket.io] Client connected: ${socket.id}. Total: ${io.engine.clientsCount}`,
	);

	// Send current user count to the new client
	socket.emit("userCount", { count: io.engine.clientsCount });

	// Broadcast updated count to all clients
	broadcastUserCount();

	// Handle custom events here in the future
	socket.on("message", (data) => {
		console.log("[Socket.io] Message from", socket.id, ":", data);
	});

	// Handle ping/pong for connection health
	socket.on("ping", () => {
		socket.emit("pong");
	});

	// Handle disconnect
	socket.on("disconnect", (reason) => {
		console.log(
			`[Socket.io] Client disconnected: ${socket.id}. Reason: ${reason}. Total: ${io.engine.clientsCount}`,
		);
		broadcastUserCount();
	});

	// Handle errors
	socket.on("error", (error: Error) => {
		console.error(`[Socket.io] Socket error for ${socket.id}:`, error);
	});
});

// Start server
httpServer.listen(PORT, () => {
	console.log(`[Socket.io] Server started on port ${PORT}`);
	console.log(`[Socket.io] CORS enabled for: ${CLIENT_URL}`);
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
