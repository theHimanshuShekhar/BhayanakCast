import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter, InMemoryBackend, RateLimits } from "#/lib/rate-limiter";

describe("Debug Rate Limiter", () => {
  it("should create fresh limiter", () => {
    console.log("Test 1: Creating limiter");
    RateLimiter.resetInstance();
    const limiter = RateLimiter.getInstance(new InMemoryBackend());
    console.log("Test 1: Limiter created");
    
    const userId = "user-1";
    const result1 = limiter.forAction("chat:send").checkAndRecord(userId, RateLimits.CHAT_SEND);
    console.log("Test 1: First result:", result1);
    
    expect(result1.allowed).toBe(true);
    expect(result1.totalAttempts).toBe(1);
  });

  it("should have fresh limiter in second test", () => {
    console.log("Test 2: Creating limiter");
    RateLimiter.resetInstance();
    const limiter = RateLimiter.getInstance(new InMemoryBackend());
    console.log("Test 2: Limiter created");
    
    const userId = "user-2";
    const result1 = limiter.forAction("chat:send").checkAndRecord(userId, RateLimits.CHAT_SEND);
    console.log("Test 2: First result:", result1);
    
    expect(result1.allowed).toBe(true);
    expect(result1.totalAttempts).toBe(1);
  });
});
