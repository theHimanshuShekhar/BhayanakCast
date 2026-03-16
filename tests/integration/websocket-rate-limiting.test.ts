import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { rateLimiter, RateLimits, RateLimiter as RateLimiterClass, InMemoryBackend } from "#/lib/rate-limiter";
import type { RateLimiterBackend, RateLimitConfig, RateLimitResult } from "#/lib/rate-limiter";

/**
 * Mock WebSocket Server for Testing
 * Simulates Socket.IO behavior without actual network connections
 */
class MockWebSocketServer {
	private rooms: Map<string, Set<string>> = new Map();
	private sockets: Map<string, MockSocket> = new Map();
	private eventHandlers: Map<string, Function[]> = new Map();

	createSocket(socketId: string, userId: string, userName: string = userId) {
		const socket = new MockSocket(socketId, userId, userName, this);
		this.sockets.set(socketId, socket);
		return socket;
	}

	joinRoom(socketId: string, roomId: string) {
		if (!this.rooms.has(roomId)) {
			this.rooms.set(roomId, new Set());
		}
		this.rooms.get(roomId)!.add(socketId);
	}

	leaveRoom(socketId: string, roomId: string) {
		this.rooms.get(roomId)?.delete(socketId);
	}

	broadcastToRoom(roomId: string, event: string, data: unknown) {
		const socketIds = this.rooms.get(roomId);
		if (socketIds) {
			socketIds.forEach((id) => {
				this.sockets.get(id)?.emit(event, data);
			});
		}
	}

	reset() {
		this.rooms.clear();
		this.sockets.clear();
		this.eventHandlers.clear();
	}
}

class MockSocket {
	public data: { userId: string; userName: string; userImage?: string };
	private server: MockWebSocketServer;
	private emittedEvents: { event: string; data: unknown }[] = [];
	private handlers: Map<string, Function> = new Map();

	constructor(
		public id: string,
		userId: string,
		userName: string,
		server: MockWebSocketServer,
	) {
		this.data = { userId, userName };
		this.server = server;
	}

	on(event: string, handler: Function) {
		this.handlers.set(event, handler);
	}

	emit(event: string, data: unknown) {
		this.emittedEvents.push({ event, data });
	}

	trigger(event: string, data: unknown) {
		const handler = this.handlers.get(event);
		if (handler) {
			handler(data);
		}
	}

	join(roomId: string) {
		this.server.joinRoom(this.id, roomId);
	}

	leave(roomId: string) {
		this.server.leaveRoom(this.id, roomId);
	}

	getEmittedEvents() {
		return this.emittedEvents;
	}

	clearEmittedEvents() {
		this.emittedEvents = [];
	}
}

/**
 * WebSocket Rate Limiter Test Helper
 * Simulates the rate limiting logic from websocket-server.ts
 */
class WebSocketRateLimiter {
	private limiter: RateLimiterClass;

	constructor(limiter: RateLimiterClass) {
		this.limiter = limiter;
	}

	checkChatRateLimit(userId: string): RateLimitResult {
		return this.limiter.forAction("chat:send").checkAndRecord(userId, RateLimits.CHAT_SEND);
	}

	checkRoomJoinRateLimit(userId: string): RateLimitResult {
		return this.limiter.forAction("room:join").checkAndRecord(userId, RateLimits.ROOM_JOIN);
	}

	checkRoomLeaveRateLimit(userId: string): RateLimitResult {
		return this.limiter.forAction("room:leave").checkAndRecord(userId, RateLimits.ROOM_LEAVE);
	}

	checkConnectionRateLimit(ip: string): RateLimitResult {
		return this.limiter.forAction("ws:connection").checkAndRecord(ip, RateLimits.WS_CONNECTION);
	}

	reset() {
		this.limiter.resetAll();
	}
}

describe("WebSocket Rate Limiting Tests", () => {
	let mockServer: MockWebSocketServer;
	let wsRateLimiter: WebSocketRateLimiter;
	let testLimiter: RateLimiterClass;

	beforeEach(() => {
		// Use a fresh rate limiter instance for each test
		RateLimiterClass.resetInstance();
		testLimiter = RateLimiterClass.getInstance(new InMemoryBackend());
		mockServer = new MockWebSocketServer();
		wsRateLimiter = new WebSocketRateLimiter(testLimiter);
	});

	afterAll(() => {
		// Clean up
		RateLimiterClass.resetInstance();
	});

	describe("Chat Message Rate Limiting", () => {
		it("allows 30 messages per 15 seconds", () => {
			const userId = "chat-test-user-1773671877921-1";

			// Send 30 messages - should all be allowed
			for (let i = 0; i < 30; i++) {
				const result = wsRateLimiter.checkChatRateLimit(userId);
				expect(result.allowed).toBe(true);
				expect(result.remaining).toBe(29 - i);
			}
		});

		it("blocks 31st message within 15 seconds", () => {
			const userId = "chat-test-user-1773671877921-2";

			// Send 30 messages
			for (let i = 0; i < 30; i++) {
				wsRateLimiter.checkChatRateLimit(userId);
			}

			// 31st message should be blocked
			const result = wsRateLimiter.checkChatRateLimit(userId);
			expect(result.allowed).toBe(false);
			expect(result.retryAfter).toBeGreaterThan(0);
		});

		it("includes retryAfter in blocked response", () => {
			const userId = "chat-test-user-1773671877921-3";

			// Exhaust limit
			for (let i = 0; i < 30; i++) {
				wsRateLimiter.checkChatRateLimit(userId);
			}

			const result = wsRateLimiter.checkChatRateLimit(userId);
			expect(result.allowed).toBe(false);
			expect(result.retryAfter).toBeGreaterThan(0);
			expect(result.retryAfter).toBeLessThanOrEqual(15); // Within window
		});

		it("rate limits are per-user", () => {
			const userId1 = "chat-test-user-4a";
			const userId2 = "chat-test-user-4b";

			// Exhaust user1's limit
			for (let i = 0; i < 30; i++) {
				wsRateLimiter.checkChatRateLimit(userId1);
			}

			// User1 should be blocked
			expect(wsRateLimiter.checkChatRateLimit(userId1).allowed).toBe(false);

			// User2 should still be able to send messages
			expect(wsRateLimiter.checkChatRateLimit(userId2).allowed).toBe(true);
		});

		it("simulates chat:error event on rate limit", () => {
			const socket = mockServer.createSocket("socket-1", "chat-test-user-1773671877921-4");
			const userId = socket.data.userId;

			// Exhaust limit
			for (let i = 0; i < 30; i++) {
				wsRateLimiter.checkChatRateLimit(userId);
			}

			// Try to send one more
			const result = wsRateLimiter.checkChatRateLimit(userId);
			if (!result.allowed) {
				socket.emit("chat:error", {
					message: `You're sending messages too quickly. Try again in ${result.retryAfter} seconds.`,
					retryAfter: result.retryAfter,
				});
			}

			const events = socket.getEmittedEvents();
			expect(events).toHaveLength(1);
			expect(events[0].event).toBe("chat:error");
			expect(events[0].data.message).toContain("Try again in");
		});
	});

	describe("Room Join Rate Limiting (WebSocket)", () => {
		it("allows 10 joins per minute", () => {
			const userId = "join-test-user-1773671877921-5";

			for (let i = 0; i < 10; i++) {
				const result = wsRateLimiter.checkRoomJoinRateLimit(userId);
				expect(result.allowed).toBe(true);
			}
		});

		it("blocks 11th join within 1 minute", () => {
			const userId = "join-test-user-1773671877921-6";

			for (let i = 0; i < 10; i++) {
				wsRateLimiter.checkRoomJoinRateLimit(userId);
			}

			const result = wsRateLimiter.checkRoomJoinRateLimit(userId);
			expect(result.allowed).toBe(false);
		});

		it("simulates room:error event on rate limit", () => {
			const socket = mockServer.createSocket("socket-2", "join-test-user-1773671877921-7");
			const userId = socket.data.userId;

			// Exhaust limit
			for (let i = 0; i < 10; i++) {
				wsRateLimiter.checkRoomJoinRateLimit(userId);
			}

			const result = wsRateLimiter.checkRoomJoinRateLimit(userId);
			if (!result.allowed) {
				socket.emit("room:error", {
					message: `You're joining rooms too quickly. Try again in ${result.retryAfter} seconds.`,
					retryAfter: result.retryAfter,
				});
			}

			const events = socket.getEmittedEvents();
			expect(events[0].event).toBe("room:error");
			expect(events[0].data.retryAfter).toBeGreaterThan(0);
		});
	});

	describe("Room Leave Rate Limiting (WebSocket)", () => {
		it("allows 5 leaves per minute", () => {
			const userId = "leave-test-user-1773671877921-8";

			for (let i = 0; i < 5; i++) {
				const result = wsRateLimiter.checkRoomLeaveRateLimit(userId);
				expect(result.allowed).toBe(true);
			}
		});

		it("blocks 6th leave within 1 minute", () => {
			const userId = "leave-test-user-1773671877921-9";

			for (let i = 0; i < 5; i++) {
				wsRateLimiter.checkRoomLeaveRateLimit(userId);
			}

			const result = wsRateLimiter.checkRoomLeaveRateLimit(userId);
			expect(result.allowed).toBe(false);
		});
	});

	describe("Connection Rate Limiting", () => {
		it("allows 30 connections per minute per IP", () => {
			const ip = "192.168.1.10";

			for (let i = 0; i < 30; i++) {
				const result = wsRateLimiter.checkConnectionRateLimit(ip);
				expect(result.allowed).toBe(true);
			}
		});

		it("blocks 31st connection from same IP", () => {
			const ip = "192.168.1.11";

			for (let i = 0; i < 30; i++) {
				wsRateLimiter.checkConnectionRateLimit(ip);
			}

			const result = wsRateLimiter.checkConnectionRateLimit(ip);
			expect(result.allowed).toBe(false);
		});

		it("tracks different IPs separately", () => {
			const ip1 = "192.168.1.12";
			const ip2 = "192.168.1.13";

			// Exhaust ip1
			for (let i = 0; i < 30; i++) {
				wsRateLimiter.checkConnectionRateLimit(ip1);
			}

			expect(wsRateLimiter.checkConnectionRateLimit(ip1).allowed).toBe(false);
			expect(wsRateLimiter.checkConnectionRateLimit(ip2).allowed).toBe(true);
		});

		it("simulates connection rejection on rate limit", () => {
			const ip = "192.168.1.14";

			// Exhaust limit
			for (let i = 0; i < 30; i++) {
				wsRateLimiter.checkConnectionRateLimit(ip);
			}

			const result = wsRateLimiter.checkConnectionRateLimit(ip);
			expect(result.allowed).toBe(false);
			expect(result.retryAfter).toBeGreaterThan(0);
		});
	});

	describe("Multiple Rate Limit Types", () => {
		it("tracks different action types independently", () => {
			const userId = "multi-test-user-1773671877921-15";

			// Exhaust chat limit
			for (let i = 0; i < 30; i++) {
				wsRateLimiter.checkChatRateLimit(userId);
			}
			expect(wsRateLimiter.checkChatRateLimit(userId).allowed).toBe(false);

			// But joins should still work
			expect(wsRateLimiter.checkRoomJoinRateLimit(userId).allowed).toBe(true);

			// And leaves should still work
			expect(wsRateLimiter.checkRoomLeaveRateLimit(userId).allowed).toBe(true);
		});

		it("user can be rate limited on multiple actions simultaneously", () => {
			const userId = "multi-test-user-1773671877921-16";

			// Exhaust all limits
			for (let i = 0; i < 30; i++) {
				wsRateLimiter.checkChatRateLimit(userId);
			}
			for (let i = 0; i < 10; i++) {
				wsRateLimiter.checkRoomJoinRateLimit(userId);
			}
			for (let i = 0; i < 5; i++) {
				wsRateLimiter.checkRoomLeaveRateLimit(userId);
			}

			expect(wsRateLimiter.checkChatRateLimit(userId).allowed).toBe(false);
			expect(wsRateLimiter.checkRoomJoinRateLimit(userId).allowed).toBe(false);
			expect(wsRateLimiter.checkRoomLeaveRateLimit(userId).allowed).toBe(false);
		});
	});

	describe("Rate Limit Reset", () => {
		it("reset clears all WebSocket rate limits", () => {
			const userId = "reset-test-user-1773671877921-20";

			// Exhaust chat limit
			for (let i = 0; i < 30; i++) {
				wsRateLimiter.checkChatRateLimit(userId);
			}
			expect(wsRateLimiter.checkChatRateLimit(userId).allowed).toBe(false);

			// Reset
			wsRateLimiter.reset();

			// Should be able to chat again
			expect(wsRateLimiter.checkChatRateLimit(userId).allowed).toBe(true);
		});
	});

	describe("Rate Limit Response Structure", () => {
		it("returns complete rate limit info", () => {
			const userId = "info-test-user-1773671877921-17";

			const result = wsRateLimiter.checkChatRateLimit(userId);

			expect(result).toHaveProperty("allowed");
			expect(result).toHaveProperty("remaining");
			expect(result).toHaveProperty("resetAt");
			expect(result).toHaveProperty("retryAfter");
			expect(result).toHaveProperty("totalAttempts");

			expect(typeof result.allowed).toBe("boolean");
			expect(typeof result.remaining).toBe("number");
			expect(typeof result.resetAt).toBe("number");
			expect(typeof result.retryAfter).toBe("number");
			expect(typeof result.totalAttempts).toBe("number");
		});

		it("remaining decreases with each request", () => {
			const userId = "info-test-user-1773671877921-18";

			const result1 = wsRateLimiter.checkChatRateLimit(userId);
			expect(result1.remaining).toBe(29);

			const result2 = wsRateLimiter.checkChatRateLimit(userId);
			expect(result2.remaining).toBe(28);

			const result3 = wsRateLimiter.checkChatRateLimit(userId);
			expect(result3.remaining).toBe(27);
		});

		it("retryAfter is 0 when allowed", () => {
			const userId = "info-test-user-1773671877921-19";

			const result = wsRateLimiter.checkChatRateLimit(userId);
			expect(result.allowed).toBe(true);
			expect(result.retryAfter).toBe(0);
		});
	});
});

describe("WebSocket Rate Limit Configurations", () => {
	it("CHAT_SEND has correct values", () => {
		expect(RateLimits.CHAT_SEND).toEqual({
			windowMs: 15 * 1000,
			maxAttempts: 30,
		});
	});

	it("CHAT_RAPID has correct values", () => {
		expect(RateLimits.CHAT_RAPID).toEqual({
			windowMs: 3 * 1000,
			maxAttempts: 5,
		});
	});

	it("ROOM_JOIN has correct values for WebSocket", () => {
		expect(RateLimits.ROOM_JOIN).toEqual({
			windowMs: 60 * 1000,
			maxAttempts: 10,
		});
	});

	it("ROOM_LEAVE has correct values for WebSocket", () => {
		expect(RateLimits.ROOM_LEAVE).toEqual({
			windowMs: 60 * 1000,
			maxAttempts: 5,
		});
	});

	it("WS_CONNECTION has correct values", () => {
		expect(RateLimits.WS_CONNECTION).toEqual({
			windowMs: 60 * 1000,
			maxAttempts: 30,
		});
	});
});
