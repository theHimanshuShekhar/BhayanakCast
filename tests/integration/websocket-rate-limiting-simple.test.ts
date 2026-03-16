import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter, InMemoryBackend, RateLimits } from "#/lib/rate-limiter";

describe("WebSocket Rate Limiting Simple", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    RateLimiter.resetInstance();
    limiter = RateLimiter.getInstance(new InMemoryBackend());
  });

  it("allows 30 chat messages per 15 seconds", () => {
    const userId = `user-${Date.now()}`;
    
    for (let i = 0; i < 30; i++) {
      const result = limiter.forAction("chat:send").checkAndRecord(userId, RateLimits.CHAT_SEND);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks 31st chat message", () => {
    const userId = `user-${Date.now()}`;
    
    for (let i = 0; i < 30; i++) {
      limiter.forAction("chat:send").checkAndRecord(userId, RateLimits.CHAT_SEND);
    }
    
    const result = limiter.forAction("chat:send").checkAndRecord(userId, RateLimits.CHAT_SEND);
    expect(result.allowed).toBe(false);
  });
});
