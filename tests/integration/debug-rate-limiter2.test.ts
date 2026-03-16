import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter, InMemoryBackend, RateLimits } from "#/lib/rate-limiter";

describe("Debug Rate Limiter 2", () => {
  beforeEach(() => {
    RateLimiter.resetInstance();
  });

  it("should allow 30 messages", () => {
    const limiter = RateLimiter.getInstance(new InMemoryBackend());
    const userId = `user-${Date.now()}`;
    
    for (let i = 0; i < 30; i++) {
      const result = limiter.forAction("chat:send").checkAndRecord(userId, RateLimits.CHAT_SEND);
      if (!result.allowed) {
        console.log(`Failed at iteration ${i}:`, result);
      }
      expect(result.allowed).toBe(true);
    }
  });

  it("should block after 30 messages", () => {
    const limiter = RateLimiter.getInstance(new InMemoryBackend());
    const userId = `user-${Date.now()}`;
    
    for (let i = 0; i < 30; i++) {
      limiter.forAction("chat:send").checkAndRecord(userId, RateLimits.CHAT_SEND);
    }
    
    const result = limiter.forAction("chat:send").checkAndRecord(userId, RateLimits.CHAT_SEND);
    expect(result.allowed).toBe(false);
  });
});
