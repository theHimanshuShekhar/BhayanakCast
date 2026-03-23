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
import { setupRoomEventHandlers, handleSocketDisconnect } from "./room-events";
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
interface SocketUserData {
	userId: string;
	userName: string;
	roomId?: string;
	isMobile: boolean;
}

const socketUserMap = new Map<string, SocketUserData>();

// Track unique users and their connection count for global user count
const connectedUsers = new Map<string, number>();

// Track WebRTC state per room
interface RoomWebRTCState {
	streamerId: string;
	streamerSocketId: string;
	viewerIds: Set<string>;
	transferInProgress: boolean;
	transferStartedAt?: number;
}

const roomWebRTCState = new Map<string, RoomWebRTCState>();

// Debounce transfers to prevent rapid changes
const transferDebounces = new Map<string, NodeJS.Timeout>();

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

// Initiate WebRTC transfer with debouncing
async function initiateWebRTCTransfer(
	roomId: string,
	oldStreamerId: string,
	newStreamerId: string,
	participants: Array<{ userId: string; userName: string }>,
) {
	// Clear any existing debounce for this room
	const existing = transferDebounces.get(roomId);
	if (existing) {
		clearTimeout(existing);
	}

	// Debounce by 500ms to batch rapid changes
	const timeout = setTimeout(async () => {
		console.log(`[WebRTC] Executing transfer in room ${roomId}`);

		// Update room WebRTC state
		roomWebRTCState.set(roomId, {
			streamerId: newStreamerId,
			streamerSocketId: "", // Will be set when new streamer connects
			viewerIds: new Set(participants.map((p) => p.userId)),
			transferInProgress: true,
			transferStartedAt: Date.now(),
		});

		// Notify all clients to initiate cleanup
		broadcastToRoom(roomId, "webrtc:transfer_initiating", {
			oldStreamerId,
			newStreamerId,
			reason: "streamer_left",
			estimatedReconnectAt: Date.now() + 3000,
			allParticipants: participants.map((p) => ({
				userId: p.userId,
				userName: p.userName,
				isMobile: false, // Will be determined by socket data
			})),
		});

		// Find new streamer's socket
		let newStreamerSocketId = "";
		for (const [socketId, userData] of socketUserMap.entries()) {
			if (userData.userId === newStreamerId && userData.roomId === roomId) {
				newStreamerSocketId = socketId;
				break;
			}
		}

		if (newStreamerSocketId) {
			// Update state with socket ID
			const state = roomWebRTCState.get(roomId);
			if (state) {
				state.streamerSocketId = newStreamerSocketId;
			}

			// Notify new streamer specifically
			io.to(newStreamerSocketId).emit("webrtc:become_streamer", {
				viewers: participants
					.filter((p) => p.userId !== newStreamerId)
					.map((p) => ({
						userId: p.userId,
						userName: p.userName,
					})),
				startBroadcastingAt: Date.now() + 1500,
			});
		}

		// Set transfer timeout (10 seconds)
		setTimeout(() => {
			const state = roomWebRTCState.get(roomId);
			if (state?.transferInProgress) {
				console.error(`[WebRTC] Transfer timeout in room ${roomId}`);
				roomWebRTCState.delete(roomId);
			}
		}, 10000);

		transferDebounces.delete(roomId);
	}, 500);

	transferDebounces.set(roomId, timeout);
}

// Socket.io connection handler
io.on("connection", (socket) => {
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

		socketUserMap.set(socket.id, {
			userId,
			userName,
			isMobile: data.isMobile || false,
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

		// Setup new WebSocket-first room event handlers
		setupRoomEventHandlers(io, socket as any);
	});

	// Note: room:join and room:leave handlers are now in room-events.ts (WebSocket-first architecture)

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

		// Check rate limit
		const chatLimiter = rateLimiter.forAction("chat:send");
		const rateLimitResult = chatLimiter.checkAndRecord(userId, RateLimits.CHAT_SEND);
		if (!rateLimitResult.allowed) {
			socket.emit("chat:error", {
				message: `You're sending messages too quickly. Try again in ${rateLimitResult.retryAfter} seconds.`,
				retryAfter: rateLimitResult.retryAfter,
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
			content: content.trim(),
			timestamp: Date.now(),
			type: "user",
		};

		console.log(`[Chat] Message from ${userName} in room ${roomId}: ${content}`);

		// Broadcast to all in room (including sender)
		broadcastToRoom(roomId, "chat:message", message);
	});

	// Note: streamer:transfer handler is now in room-events.ts (WebSocket-first architecture)

	// ============ WebRTC Signaling Events ============

	// Streamer ready to broadcast
	socket.on("webrtc:streamer_ready", (data: { roomId: string; audioConfig: string }) => {
		const { roomId, audioConfig } = data;
		const userId = socket.data.userId;

		console.log(`[WebRTC] Streamer ${userId} ready in room ${roomId}`);

		// Update room WebRTC state
		const state = roomWebRTCState.get(roomId);
		if (state) {
			state.streamerId = userId;
			state.streamerSocketId = socket.id;
			state.transferInProgress = false;
		}

		// Notify all room members
		broadcastToRoom(roomId, "webrtc:streamer_ready", {
			streamerId: userId,
			streamerName: socket.data.userName,
			audioConfig,
		});

		// Trigger viewer reconnection after a delay
		setTimeout(() => {
			broadcastToRoom(roomId, "webrtc:reconnect_now", {
				newStreamerId: userId,
				newStreamerName: socket.data.userName,
				streamerSocketId: socket.id,
			});
		}, 1000);
	});

	// Screen sharing ended
	socket.on("webrtc:screen_share_ended", async (data: { roomId: string }) => {
		const { roomId } = data;
		const userId = socket.data.userId;

		console.log(`[WebRTC] Screen share ended by ${userId} in room ${roomId}`);

		// Check in-memory state if user is streamer
		const { getRoomState } = await import("./room-state");
		const room = getRoomState(roomId);
		if (!room || room.streamerId !== userId) {
			return; // Not the streamer, ignore
		}

		// Clear WebRTC state
		roomWebRTCState.delete(roomId);

		// Streamer stopped streaming but stays in room
		// Status changes to preparing, but participant stays
		const { updateRoomStatus } = await import("./room-state");
		updateRoomStatus(roomId, "preparing");

		// Broadcast status change
		broadcastToRoom(roomId, "room:status_changed", { status: "preparing" });
		broadcastToRoom(roomId, "webrtc:screen_share_ended", { streamerId: userId });

		console.log(`[WebRTC] Screen share ended in room ${roomId}, status changed to preparing`);
	});

	// WebRTC offer from viewer
	socket.on("webrtc:offer", (data: { roomId: string; toUserId: string; offer: RTCSessionDescriptionInit }) => {
		const { roomId, toUserId, offer } = data;
		const fromUserId = socket.data.userId;

		// Rate limit check
		const rateLimitResult = rateLimiter.checkAndRecord(fromUserId, RateLimits.WEBRTC_SIGNALING);
		if (!rateLimitResult.allowed) {
			console.warn(`[WebRTC] Rate limit exceeded for user ${fromUserId}`);
			return;
		}

		// Validate sender is in the room
		const senderData = socketUserMap.get(socket.id);
		if (!senderData || senderData.roomId !== roomId) {
			console.warn(`[WebRTC] User ${fromUserId} attempted to send offer but is not in room ${roomId}`);
			return;
		}

		// Validate target is the streamer (viewers send offers TO streamers)
		const targetData = Array.from(socketUserMap.values()).find(
			(u) => u.userId === toUserId && u.roomId === roomId
		);
		if (!targetData) {
			console.warn(`[WebRTC] Target user ${toUserId} not found in room ${roomId}`);
			return;
		}

		// Find target socket
		for (const [targetSocketId, userData] of socketUserMap.entries()) {
			if (userData.userId === toUserId && userData.roomId === roomId) {
				io.to(targetSocketId).emit("webrtc:offer", {
					fromUserId,
					fromUserName: socket.data.userName,
					offer,
				});
				break;
			}
		}
	});

	// WebRTC answer from streamer
	socket.on("webrtc:answer", (data: { roomId: string; toUserId: string; answer: RTCSessionDescriptionInit }) => {
		const { roomId, toUserId, answer } = data;
		const fromUserId = socket.data.userId;

		// Rate limit check
		const rateLimitResult = rateLimiter.checkAndRecord(fromUserId, RateLimits.WEBRTC_SIGNALING);
		if (!rateLimitResult.allowed) {
			console.warn(`[WebRTC] Rate limit exceeded for user ${fromUserId}`);
			return;
		}

		// Validate sender is in the room
		const senderData = socketUserMap.get(socket.id);
		if (!senderData || senderData.roomId !== roomId) {
			console.warn(`[WebRTC] User ${fromUserId} attempted to send answer but is not in room ${roomId}`);
			return;
		}

		// Validate target is a viewer (streamers send answers TO viewers)
		const targetData = Array.from(socketUserMap.values()).find(
			(u) => u.userId === toUserId && u.roomId === roomId
		);
		if (!targetData) {
			console.warn(`[WebRTC] Target user ${toUserId} not found in room ${roomId}`);
			return;
		}

		// Find target socket
		for (const [targetSocketId, userData] of socketUserMap.entries()) {
			if (userData.userId === toUserId && userData.roomId === roomId) {
				io.to(targetSocketId).emit("webrtc:answer", {
					fromUserId,
					answer,
				});
				break;
			}
		}
	});

	// ICE candidate exchange
	socket.on("webrtc:ice_candidate", (data: { roomId: string; toUserId: string; candidate: RTCIceCandidateInit }) => {
		const { roomId, toUserId, candidate } = data;
		const fromUserId = socket.data.userId;

		// Rate limit check
		const rateLimitResult = rateLimiter.checkAndRecord(fromUserId, RateLimits.WEBRTC_SIGNALING);
		if (!rateLimitResult.allowed) {
			console.warn(`[WebRTC] Rate limit exceeded for user ${fromUserId}`);
			return;
		}

		// Validate sender is in the room
		const senderData = socketUserMap.get(socket.id);
		if (!senderData || senderData.roomId !== roomId) {
			console.warn(`[WebRTC] User ${fromUserId} attempted to send ICE candidate but is not in room ${roomId}`);
			return;
		}

		// Validate target is in the same room
		const targetData = Array.from(socketUserMap.values()).find(
			(u) => u.userId === toUserId && u.roomId === roomId
		);
		if (!targetData) {
			console.warn(`[WebRTC] Target user ${toUserId} not found in room ${roomId}`);
			return;
		}

		// Find target socket
		for (const [targetSocketId, userData] of socketUserMap.entries()) {
			if (userData.userId === toUserId && userData.roomId === roomId) {
				io.to(targetSocketId).emit("webrtc:ice_candidate", {
					fromUserId,
					candidate,
				});
				break;
			}
		}
	});

	// Handle disconnect using WebSocket-first architecture
	socket.on("disconnect", async () => {
		const socketData = socketUserMap.get(socket.id);
		if (!socketData) return;

		const { userId, userName } = socketData;
		console.log(`[Socket.io] Client disconnected: ${socket.id} (user: ${userName})`);

		// Use WebSocket-first handler to leave all rooms
		try {
			await handleSocketDisconnect(
				io,
				socket as any,
				sendSystemMessage,
				initiateWebRTCTransfer,
				(roomId) => roomWebRTCState.get(roomId),
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
		const { runRoomCleanupJob } = await import("./room-events");
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
			const { runRoomCleanupJob } = await import("./room-events");
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
