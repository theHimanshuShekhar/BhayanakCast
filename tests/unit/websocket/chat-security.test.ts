/**
 * Chat Security Tests
 *
 * Verifies that chat messages are:
 * - Subject to CHAT_RAPID rate limiting (5 messages per 3 seconds)
 * - Filtered through the profanity filter before broadcasting
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
	RateLimiter,
	RateLimits,
	InMemoryBackend,
} from "../../../src/lib/rate-limiter";
import { censorText } from "../../../src/lib/profanity-filter";

describe("Chat: CHAT_RAPID rate limiting", () => {
	let rateLimiter: RateLimiter;

	beforeEach(() => {
		// Use a fresh limiter per test to avoid inter-test state
		RateLimiter.resetInstance();
		rateLimiter = new RateLimiter(new InMemoryBackend());
	});

	it("allows up to 5 messages in a 3-second window", () => {
		const rapidLimiter = rateLimiter.forAction("chat:rapid");
		const userId = "user-1";

		for (let i = 0; i < 5; i++) {
			const result = rapidLimiter.checkAndRecord(userId, RateLimits.CHAT_RAPID);
			expect(result.allowed).toBe(true);
		}
	});

	it("blocks the 6th message within the 3-second window", () => {
		const rapidLimiter = rateLimiter.forAction("chat:rapid");
		const userId = "user-2";

		// Send 5 messages (all allowed)
		for (let i = 0; i < 5; i++) {
			rapidLimiter.checkAndRecord(userId, RateLimits.CHAT_RAPID);
		}

		// 6th message should be denied
		const result = rapidLimiter.checkAndRecord(userId, RateLimits.CHAT_RAPID);
		expect(result.allowed).toBe(false);
		expect(result.retryAfter).toBeGreaterThan(0);
	});

	it("does not affect different users independently", () => {
		const rapidLimiter = rateLimiter.forAction("chat:rapid");

		// Exhaust user-A's limit
		for (let i = 0; i < 6; i++) {
			rapidLimiter.checkAndRecord("user-A", RateLimits.CHAT_RAPID);
		}
		const userAResult = rapidLimiter.checkAndRecord("user-A", RateLimits.CHAT_RAPID);
		expect(userAResult.allowed).toBe(false);

		// user-B should still be allowed
		const userBResult = rapidLimiter.checkAndRecord("user-B", RateLimits.CHAT_RAPID);
		expect(userBResult.allowed).toBe(true);
	});

	it("CHAT_RAPID config has correct values", () => {
		expect(RateLimits.CHAT_RAPID.windowMs).toBe(3000);
		expect(RateLimits.CHAT_RAPID.maxAttempts).toBe(5);
	});
});

describe("Chat: profanity filter applied to messages", () => {
	it("passes clean messages through unchanged", () => {
		expect(censorText("Hello everyone!")).toBe("Hello everyone!");
		expect(censorText("Great stream, loving it")).toBe(
			"Great stream, loving it",
		);
	});

	it("censors profane English words", () => {
		const result = censorText("what the fuck is happening");
		expect(result).not.toContain("fuck");
		expect(result).toContain("***");
	});

	it("censors Hindi profanity", () => {
		const result = censorText("behenchod stop this");
		expect(result).not.toContain("behenchod");
		expect(result).toContain("***");
	});

	it("preserves surrounding text after censoring", () => {
		const result = censorText("Oh fuck that was great!");
		expect(result).toMatch(/Oh .* that was great!/);
		expect(result).not.toContain("fuck");
	});

	it("handles empty strings", () => {
		expect(censorText("")).toBe("");
	});

	it("handles strings with no profanity", () => {
		const clean = "This is a perfectly fine message.";
		expect(censorText(clean)).toBe(clean);
	});
});
