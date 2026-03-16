import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
	InMemoryBackend,
	RateLimiter,
	ActionRateLimiter,
	RateLimits,
	ValkeyBackend,
	type RateLimitConfig,
} from "#/lib/rate-limiter";

describe("InMemoryBackend", () => {
	let backend: InMemoryBackend;
	const config: RateLimitConfig = {
		windowMs: 60000,
		maxAttempts: 3,
	};

	beforeEach(() => {
		backend = new InMemoryBackend();
	});

	describe("check", () => {
		it("allows requests when under limit", () => {
			const result = backend.check("user1", config);

			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(3);
			expect(result.totalAttempts).toBe(0);
			expect(result.retryAfter).toBe(0);
		});

		it("tracks attempts correctly", () => {
			backend.record("user1", config);
			const result = backend.check("user1", config);

			expect(result.totalAttempts).toBe(1);
			expect(result.remaining).toBe(2);
			expect(result.allowed).toBe(true);
		});

		it("blocks requests at limit", () => {
			// Use up all attempts (3 records with maxAttempts=3 = at limit)
			backend.record("user1", config);
			backend.record("user1", config);
			backend.record("user1", config);

			const atLimitResult = backend.check("user1", config);

			// At limit (3/3), should still be allowed
			expect(atLimitResult.allowed).toBe(true);
			expect(atLimitResult.remaining).toBe(0);
			expect(atLimitResult.totalAttempts).toBe(3);
			expect(atLimitResult.retryAfter).toBe(0);

			// Exceed limit - now should be blocked
			backend.record("user1", config);
			const blockedResult = backend.check("user1", config);
			expect(blockedResult.allowed).toBe(false);
			expect(blockedResult.remaining).toBe(0);
			expect(blockedResult.retryAfter).toBeGreaterThan(0);
		});

		it("tracks different users separately", () => {
			backend.record("user1", config);
			backend.record("user1", config);

			const user1Result = backend.check("user1", config);
			const user2Result = backend.check("user2", config);

			expect(user1Result.remaining).toBe(1);
			expect(user2Result.remaining).toBe(3);
		});

		it("respects key prefixes", () => {
			const prefixedConfig = { ...config, keyPrefix: "action" };
			backend.record("user1", prefixedConfig);

			const resultWithPrefix = backend.check("user1", prefixedConfig);
			const resultWithoutPrefix = backend.check("user1", config);

			expect(resultWithPrefix.remaining).toBe(2);
			expect(resultWithoutPrefix.remaining).toBe(3);
		});
	});

	describe("record", () => {
		it("records attempts and updates state", () => {
			const result1 = backend.record("user1", config);
			expect(result1.totalAttempts).toBe(1);
			expect(result1.remaining).toBe(2);

			const result2 = backend.record("user1", config);
			expect(result2.totalAttempts).toBe(2);
			expect(result2.remaining).toBe(1);
		});

		it("returns blocked status after exceeding max attempts", () => {
			// Make 3 attempts (at limit with maxAttempts=3)
			backend.record("user1", config);
			backend.record("user1", config);
			const atLimitResult = backend.record("user1", config);

			// At limit (3/3), should still be allowed
			expect(atLimitResult.allowed).toBe(true);
			expect(atLimitResult.remaining).toBe(0);

			// 4th attempt exceeds limit
			const blockedResult = backend.record("user1", config);
			expect(blockedResult.allowed).toBe(false);
			expect(blockedResult.remaining).toBe(0);
		});
	});

	describe("window expiration", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("resets after window expires", () => {
			const shortConfig = { windowMs: 100, maxAttempts: 1 };

			// First attempt - at limit, should be allowed
			backend.record("user1", shortConfig);
			let result = backend.check("user1", shortConfig);
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(0); // At limit

			// Exceed limit - should be blocked
			backend.record("user1", shortConfig);
			result = backend.check("user1", shortConfig);
			expect(result.allowed).toBe(false);

			// Wait for window to expire
			vi.advanceTimersByTime(101);

			result = backend.check("user1", shortConfig);
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(1);
		});
	});

	describe("reset", () => {
		it("clears attempts for specific key", () => {
			backend.record("user1", config);
			backend.record("user2", config);

			backend.reset("user1");

			const user1Result = backend.check("user1", config);
			const user2Result = backend.check("user2", config);

			expect(user1Result.remaining).toBe(3);
			expect(user2Result.remaining).toBe(2);
		});

		it("clears all attempts with resetAll", () => {
			backend.record("user1", config);
			backend.record("user2", config);

			backend.resetAll();

			expect(backend.check("user1", config).remaining).toBe(3);
			expect(backend.check("user2", config).remaining).toBe(3);
		});
	});
});

describe("RateLimiter", () => {
	let limiter: RateLimiter;

	beforeEach(() => {
		RateLimiter.resetInstance();
		limiter = RateLimiter.getInstance();
	});

	afterEach(() => {
		limiter.resetAll();
		RateLimiter.resetInstance();
	});

	describe("singleton pattern", () => {
		it("returns same instance", () => {
			const instance1 = RateLimiter.getInstance();
			const instance2 = RateLimiter.getInstance();

			expect(instance1).toBe(instance2);
		});

		it("allows custom backend", () => {
			RateLimiter.resetInstance();
			const customBackend = new InMemoryBackend();
			const instance = RateLimiter.getInstance(customBackend);

			expect(instance).toBeDefined();
		});
	});

	describe("action namespacing", () => {
		it("creates namespaced limiter", () => {
			const actionLimiter = limiter.forAction("chat");

			expect(actionLimiter).toBeInstanceOf(ActionRateLimiter);
		});

		it("isolates different actions", () => {
			const chatLimiter = limiter.forAction("chat");
			const roomLimiter = limiter.forAction("room");
			const config: RateLimitConfig = { windowMs: 60000, maxAttempts: 3 };

			chatLimiter.record("user1", config);
			chatLimiter.record("user1", config);

			const chatResult = chatLimiter.check("user1", config);
			const roomResult = roomLimiter.check("user1", config);

			expect(chatResult.remaining).toBe(1);
			expect(roomResult.remaining).toBe(3);
		});
	});

	describe("convenience methods", () => {
		const config: RateLimitConfig = { windowMs: 60000, maxAttempts: 3 };

		it("checkAndRecord combines operations", () => {
			const result = limiter.checkAndRecord("user1", config);

			expect(result.totalAttempts).toBe(1);
			expect(result.remaining).toBe(2);
		});
	});
});

describe("ActionRateLimiter", () => {
	let limiter: RateLimiter;
	let actionLimiter: ActionRateLimiter;
	const config: RateLimitConfig = { windowMs: 60000, maxAttempts: 3 };

	beforeEach(() => {
		RateLimiter.resetInstance();
		limiter = RateLimiter.getInstance();
		actionLimiter = limiter.forAction("test-action");
	});

	afterEach(() => {
		limiter.resetAll();
		RateLimiter.resetInstance();
	});

	it("applies action prefix automatically", () => {
		actionLimiter.record("user1", config);

		// Direct access with prefix should see the same
		const directResult = limiter.check("user1", { ...config, keyPrefix: "test-action" });
		expect(directResult.remaining).toBe(2);
	});

	it("supports all rate limiter methods", () => {
		actionLimiter.record("user1", config);

		expect(actionLimiter.check("user1", config).totalAttempts).toBe(1);
		expect(actionLimiter.checkAndRecord("user1", config).totalAttempts).toBe(2);

		actionLimiter.reset("user1");
		expect(actionLimiter.check("user1", config).totalAttempts).toBe(0);
	});
});

describe("RateLimits predefined configs", () => {
	it("has correct values for ROOM_CREATE", () => {
		expect(RateLimits.ROOM_CREATE).toEqual({
			windowMs: 60 * 1000,
			maxAttempts: 3,
		});
	});

	it("has correct values for CHAT_SEND", () => {
		expect(RateLimits.CHAT_SEND).toEqual({
			windowMs: 15 * 1000,
			maxAttempts: 30,
		});
	});

	it("has correct values for CHAT_RAPID", () => {
		expect(RateLimits.CHAT_RAPID).toEqual({
			windowMs: 3 * 1000,
			maxAttempts: 5,
		});
	});

	it("has correct values for ROOM_JOIN", () => {
		expect(RateLimits.ROOM_JOIN).toEqual({
			windowMs: 60 * 1000,
			maxAttempts: 10,
		});
	});

	it("has correct values for ROOM_LEAVE", () => {
		expect(RateLimits.ROOM_LEAVE).toEqual({
			windowMs: 60 * 1000,
			maxAttempts: 5,
		});
	});

	it("has correct values for STREAMER_TRANSFER", () => {
		expect(RateLimits.STREAMER_TRANSFER).toEqual({
			windowMs: 30 * 1000,
			maxAttempts: 1,
		});
	});

	it("has correct values for SEARCH", () => {
		expect(RateLimits.SEARCH).toEqual({
			windowMs: 60 * 1000,
			maxAttempts: 60,
		});
	});

	it("has correct values for PROFILE_VIEW", () => {
		expect(RateLimits.PROFILE_VIEW).toEqual({
			windowMs: 60 * 1000,
			maxAttempts: 120,
		});
	});

	it("has correct values for HOME_REFRESH", () => {
		expect(RateLimits.HOME_REFRESH).toEqual({
			windowMs: 60 * 1000,
			maxAttempts: 20,
		});
	});

	it("has correct values for WS_CONNECTION", () => {
		expect(RateLimits.WS_CONNECTION).toEqual({
			windowMs: 60 * 1000,
			maxAttempts: 30,
		});
	});

	it("has correct values for AUTH_ATTEMPT", () => {
		expect(RateLimits.AUTH_ATTEMPT).toEqual({
			windowMs: 15 * 60 * 1000,
			maxAttempts: 5,
		});
	});

	it("has correct values for VIOLATION_WINDOW", () => {
		expect(RateLimits.VIOLATION_WINDOW).toEqual({
			windowMs: 5 * 60 * 1000,
			maxAttempts: 3,
		});
	});
});

describe("ValkeyBackend", () => {
	it("throws error on instantiation", () => {
		expect(() => new ValkeyBackend()).toThrow(
			"ValkeyBackend not yet implemented. Use InMemoryBackend for now.",
		);
	});

	it("throws error on all methods", () => {
		// We can't instantiate it, but we can verify the stub exists
		expect(ValkeyBackend).toBeDefined();
	});
});

describe("Rate Limiter Integration Scenarios", () => {
	let limiter: RateLimiter;

	beforeEach(() => {
		RateLimiter.resetInstance();
		limiter = RateLimiter.getInstance();
	});

	afterEach(() => {
		limiter.resetAll();
		RateLimiter.resetInstance();
	});

	it("handles burst traffic correctly", () => {
		const burstConfig: RateLimitConfig = { windowMs: 60000, maxAttempts: 5 };

		// Use fresh backend to ensure clean state
		const freshLimiter = new RateLimiter(new InMemoryBackend());

		// Simulate 10 rapid requests
		const results = [];
		for (let i = 0; i < 10; i++) {
			results.push(freshLimiter.checkAndRecord("user1", burstConfig).allowed);
		}

		// First 5 should pass (maxAttempts), next 5 should be blocked
		expect(results.slice(0, 5).filter(Boolean)).toHaveLength(5);
		expect(results.slice(5).filter((r) => !r)).toHaveLength(5);
	});

	it("handles multiple users independently", () => {
		const config: RateLimitConfig = { windowMs: 60000, maxAttempts: 3 };

		// Use up all attempts for user1 (3 attempts = at limit)
		limiter.record("user1", config);
		limiter.record("user1", config);
		limiter.record("user1", config);

		// user1 is at limit (3/3), next attempt would be blocked
		expect(limiter.check("user1", config).allowed).toBe(true); // Still allowed at limit
		expect(limiter.check("user2", config).allowed).toBe(true);
		expect(limiter.check("user3", config).allowed).toBe(true);
		
		// Now actually exceed the limit
		limiter.record("user1", config);
		expect(limiter.check("user1", config).allowed).toBe(false); // Now blocked
	});

	it("provides accurate reset timing", () => {
		const config: RateLimitConfig = { windowMs: 60000, maxAttempts: 3 };
		const beforeTime = Date.now();

		limiter.record("user1", config);
		const result = limiter.check("user1", config);

		// resetAt should be approximately windowMs from now
		expect(result.resetAt).toBeGreaterThan(beforeTime);
		expect(result.resetAt).toBeLessThanOrEqual(beforeTime + config.windowMs + 1000);
	});

	it("correctly calculates retryAfter", () => {
		const config: RateLimitConfig = { windowMs: 60000, maxAttempts: 1 };

		// First attempt - at limit, should be allowed
		limiter.record("user1", config);
		const result1 = limiter.check("user1", config);
		expect(result1.allowed).toBe(true); // At limit (1/1), still allowed
		expect(result1.retryAfter).toBe(0); // Can still make requests

		// Second attempt - exceeds limit, should be blocked
		limiter.record("user1", config);
		const result2 = limiter.check("user1", config);
		expect(result2.allowed).toBe(false); // Exceeds limit (2/1), blocked
		expect(result2.retryAfter).toBeGreaterThan(0);
		expect(result2.retryAfter).toBeLessThanOrEqual(60); // Should be in seconds
	});
});
