/**
 * WebSocket WebRTC Signaling Integration Tests
 *
 * Tests for WebRTC event handling via WebSocket
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Server } from "socket.io";
import { createServer } from "http";
import { io as Client } from "socket.io-client";

describe("WebRTC WebSocket Signaling", () => {
	let io: Server;
	let server: ReturnType<typeof createServer>;
	let clientSocket: ReturnType<typeof Client>;
	const PORT = 3002;

	beforeAll(async () => {
		return new Promise<void>((resolve) => {
			server = createServer();
			io = new Server(server);

			server.listen(PORT, () => {
				clientSocket = Client(`http://localhost:${PORT}`);
				clientSocket.on("connect", resolve);
			});
		});
	});

	afterAll(async () => {
		return new Promise<void>((resolve) => {
			if (clientSocket) {
				clientSocket.close();
			}
			if (io) {
				io.close();
			}
			if (server) {
				server.close(() => resolve());
			} else {
				resolve();
			}
		});
	});

	describe("webrtc:streamer_ready", () => {
		it("forwards streamer ready event to room", async () => {
			const mockClient2 = Client(`http://localhost:${PORT}`);

			await new Promise<void>((resolve) => {
				mockClient2.on("connect", resolve);
			});

			// Join room
			clientSocket.emit("room:join", { roomId: "test-room" });
			mockClient2.emit("room:join", { roomId: "test-room" });

			// Wait for connection
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Listen for streamer ready on client2
			const receivedPromise = new Promise<void>((resolve) => {
				mockClient2.on("webrtc:streamer_ready", (data) => {
					expect(data.streamerId).toBe("user-1");
					expect(data.audioConfig).toBe("system-and-mic");
					resolve();
				});
			});

			// Emit streamer ready from client1
			clientSocket.emit("webrtc:streamer_ready", {
				roomId: "test-room",
				audioConfig: "system-and-mic",
			});

			await receivedPromise;
			mockClient2.close();
		});
	});

	describe("webrtc:offer/answer/ice_candidate", () => {
		it("forwards offer from viewer to streamer", async () => {
			const mockStreamer = Client(`http://localhost:${PORT}`);

			await new Promise<void>((resolve) => {
				mockStreamer.on("connect", resolve);
			});

			// Join room
			mockStreamer.emit("room:join", { roomId: "test-room" });
			clientSocket.emit("room:join", { roomId: "test-room" });

			await new Promise((resolve) => setTimeout(resolve, 100));

			// Streamer listens for offer
			const receivedPromise = new Promise<void>((resolve) => {
				mockStreamer.on("webrtc:offer", (data) => {
					expect(data.fromUserId).toBe("viewer-1");
					expect(data.offer).toEqual({ type: "offer", sdp: "test-sdp" });
					resolve();
				});
			});

			// Viewer sends offer
			clientSocket.emit("identify", { userId: "viewer-1" });
			clientSocket.emit("webrtc:offer", {
				roomId: "test-room",
				toUserId: "streamer-1",
				offer: { type: "offer", sdp: "test-sdp" },
			});

			await receivedPromise;
			mockStreamer.close();
		});
	});
});
