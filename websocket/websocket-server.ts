import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env files FIRST before any other imports (from parent directory)
config({ path: join(__dirname, "..", ".env.local"), override: true });
config({ path: join(__dirname, "..", ".env"), override: true });

import { Server, type Socket } from "socket.io";
import { createServer } from "http";
import { setupRoomEventHandlers, handleSocketDisconnect } from "./room";
import { setupChatHandlers, sendSystemMessage } from "./chat";
import { setupStreamingHandlers, initiateStreamerTransfer } from "./streaming";
import { initializeCommunityStats } from "../src/db/queries/community-stats";
import { RateLimits, rateLimiter } from "../src/lib/rate-limiter";

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
export interface SocketUserData {
	userId: string;
	userName: string;
	roomId?: string;
	isMobile: boolean;
	peerId?: string; // PeerJS ID for WebRTC connections
}

// Export socketUserMap for room-events.ts to update
export { socketUserMap };

const socketUserMap = new Map<string, SocketUserData>();

// Track unique users and their connection count for global user count
const connectedUsers = new Map<string, number>();

// Broadcast user count to all connected clients
function broadcastUserCount() {
	const count = connectedUsers.size;
	console.log(`[WebSocket] Broadcasting user count: ${count}`);
	io.emit("userCount", { count });
}

// Socket.io connection handler
io.on("connection", (socket: Socket) => {
	const clientIp = socket.handshake.address;
	console.log(`[Socket.io] Client connected: ${socket.id} (IP: ${clientIp})`);

	// Check connection rate limit
	const connectionLimiter = rateLimiter.forAction("ws:connection");
	const rateLimitResult = connectionLimiter.checkAndRecord(clientIp, RateLimits.WS_CONNECTION);
	if (!rateLimitResult.allowed) {
		console.log(`[Socket.io] Connection rejected for IP ${clientIp}: rate limit exceeded`);
		socket.emit("error", {
			message: `Connection rate limit exceeded. Try again in ${rateLimitResult.retryAfter} seconds.`,
		});
		socket.disconnect(true);
		return;
	}

	// Send current user count on connection
	socket.emit("userCount", { count: connectedUsers.size });

	// Handle user identification
	socket.on("identify", (data: { userId?: string; userName?: string; userImage?: string | null; isMobile?: boolean }) => {
		const userId = data.userId || `anonymous:${socket.id}`;
		const userName = data.userName || userId;

		socket.data.userId = userId;
		socket.data.userName = userName;
		socket.data.userImage = data.userImage;
		socket.data.isMobile = data.isMobile || false;

		// Preserve existing roomId and peerId if already in socketUserMap
		const existingData = socketUserMap.get(socket.id);
		socketUserMap.set(socket.id, {
			userId,
			userName,
			isMobile: data.isMobile || false,
			roomId: existingData?.roomId,
			peerId: existingData?.peerId,
		});

		// Increment connection count for this user
		const currentCount = connectedUsers.get(userId) || 0;
		connectedUsers.set(userId, currentCount + 1);
		// Only broadcast if this is the first connection for this user
		if (currentCount === 0) {
			broadcastUserCount();
		}

		console.log(`[Socket.io] User identified: ${userName} (${userId}) (socket: ${socket.id}) (mobile: ${data.isMobile})`);
		socket.emit("identified", { userId, userName });

		// Setup module-specific event handlers
		setupRoomEventHandlers(io, socket as any);
		setupChatHandlers(io, socket as any, socketUserMap);
		setupStreamingHandlers(io, socket as any, socketUserMap);
	});

	// Handle disconnect
	socket.on("disconnect", async () => {
		const socketData = socketUserMap.get(socket.id);
		if (!socketData) return;

		const { userId, userName } = socketData;
		console.log(`[Socket.io] Client disconnected: ${socket.id} (user: ${userName})`);

		// Use room handler to leave all rooms
		try {
			await handleSocketDisconnect(
				io,
				socket as any,
				(roomId, content) => sendSystemMessage(io, roomId, content),
				(roomId, newStreamerId, participants) => initiateStreamerTransfer(io, roomId, newStreamerId, participants),
			);
		} catch (error) {
			console.error(`[RoomEvents] Error in disconnect handler:`, error);
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

	// Run initial cleanup using WebSocket-first architecture
	console.log("[RoomManager] Running initial cleanup on startup...");
	try {
		const { runRoomCleanupJob } = await import("./room");
		await runRoomCleanupJob(io);
	} catch (error) {
		console.error("[RoomManager] Error during initial cleanup:", error);
	}

	// Calculate initial community stats
	console.log("[RoomManager] Calculating initial community stats...");
	try {
		const stats = await initializeCommunityStats();
		console.log("[RoomManager] Initial community stats calculated:", {
			totalWatchSecondsThisWeek: stats.totalWatchSecondsThisWeek,
			totalWatchHoursThisWeek: stats.totalWatchHoursThisWeek,
		});
	} catch (error) {
		console.error("[RoomManager] Error during initial stats calculation:", error);
	}

	// Setup room cleanup job - runs every 5 minutes (WebSocket-first)
	const CLEANUP_INTERVAL = 5 * 60 * 1000;
	console.log(`[RoomManager] Room cleanup scheduled every ${CLEANUP_INTERVAL / 1000 / 60} minutes`);

	setInterval(async () => {
		try {
			const { runRoomCleanupJob } = await import("./room");
			await runRoomCleanupJob(io);
		} catch (error) {
			console.error("[RoomManager] Error during room cleanup:", error);
		}
	}, CLEANUP_INTERVAL);

	// Setup community stats recalculation - runs every 30 minutes
	const STATS_INTERVAL = 30 * 60 * 1000;
	console.log(`[RoomManager] Community stats recalculation scheduled every ${STATS_INTERVAL / 1000 / 60} minutes`);

	setInterval(async () => {
		try {
			console.log("[RoomManager] Recalculating community stats...");
			const stats = await initializeCommunityStats();
			console.log("[RoomManager] Community stats updated:", {
				totalWatchSecondsThisWeek: stats.totalWatchSecondsThisWeek,
				totalWatchHoursThisWeek: stats.totalWatchHoursThisWeek,
			});
		} catch (error) {
			console.error("[RoomManager] Error during community stats recalculation:", error);
		}
	}, STATS_INTERVAL);
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
