import { describe, expect, it, beforeEach, vi } from "vitest";
import {
	ConnectionRetryManager,
	createConnectionRetryManager,
	retryWithBackoff,
	DEFAULT_RETRY_CONFIG,
	type RetryConfig,
} from "../../src/lib/connection-retry";

describe("ConnectionRetryManager", () => {
	let manager: ConnectionRetryManager;

	beforeEach(() => {
		manager = new ConnectionRetryManager();
	});

	describe("initialization", () => {
		it("should initialize with default config", () => {
			const state = manager.getState();
			expect(state.attempt).toBe(0);
			expect(state.status).toBe("idle");
			expect(state.nextDelayMs).toBe(DEFAULT_RETRY_CONFIG.initialDelayMs);
		});

		it("should accept custom config", () => {
			const customManager = new ConnectionRetryManager({
				maxRetries: 10,
				initialDelayMs: 500,
			});
			const state = customManager.getState();
			expect(state.nextDelayMs).toBe(500);
		});
	});

	describe("state management", () => {
		it("should return current state", () => {
			const state = manager.getState();
			expect(state).toHaveProperty("attempt");
			expect(state).toHaveProperty("status");
			expect(state).toHaveProperty("nextDelayMs");
		});

		it("should mark as connecting", () => {
			manager.markConnecting();
			expect(manager.getStatus()).toBe("connecting");
		});

		it("should mark as success", () => {
			manager.markConnecting();
			manager.markSuccess();
			expect(manager.getStatus()).toBe("connected");
			expect(manager.getState().attempt).toBe(0);
		});

		it("should mark as failed", () => {
			manager.markFailed("Test error");
			expect(manager.getStatus()).toBe("failed");
			expect(manager.getState().lastError).toBe("Test error");
		});
	});

	describe("retry logic", () => {
		it("should allow retry within limit", () => {
			expect(manager.shouldRetry()).toBe(true);
		});

		it("should not allow retry after max attempts", async () => {
			const config: Partial<RetryConfig> = { maxRetries: 2 };
			manager = new ConnectionRetryManager(config);

			// Exhaust retries
			await manager.waitForRetry();
			await manager.waitForRetry();

			expect(manager.shouldRetry()).toBe(false);
			expect(manager.getStatus()).toBe("failed");
		});

		it("should increment attempt counter on retry", async () => {
			await manager.waitForRetry();
			expect(manager.getState().attempt).toBe(1);

			await manager.waitForRetry();
			expect(manager.getState().attempt).toBe(2);
		});

		it("should increase delay exponentially", async () => {
			const config: Partial<RetryConfig> = {
				initialDelayMs: 100,
				backoffMultiplier: 2,
				maxDelayMs: 1000,
				jitterFactor: 0, // Disable jitter for predictable test
			};
			manager = new ConnectionRetryManager(config);

			await manager.waitForRetry();
			const firstDelay = manager.getState().nextDelayMs;
			expect(firstDelay).toBe(200); // 100 * 2

			await manager.waitForRetry();
			const secondDelay = manager.getState().nextDelayMs;
			expect(secondDelay).toBe(400); // 200 * 2
		});

		it("should cap delay at maxDelayMs", async () => {
			const config: Partial<RetryConfig> = {
				initialDelayMs: 100,
				backoffMultiplier: 10,
				maxDelayMs: 500,
			};
			manager = new ConnectionRetryManager(config);

			await manager.waitForRetry();
			await manager.waitForRetry();

			const nextDelay = manager.getState().nextDelayMs;
			expect(nextDelay).toBeLessThanOrEqual(550); // 500 + jitter
		});

		it("should reset to idle state", () => {
			manager.markConnecting();
			manager.markFailed("error");
			manager.reset();

			const state = manager.getState();
			expect(state.attempt).toBe(0);
			expect(state.status).toBe("idle");
			expect(state.lastError).toBeUndefined();
		});
	});

	describe("error recording", () => {
		it("should record error", () => {
			manager.recordError("Connection refused");
			expect(manager.getState().lastError).toBe("Connection refused");
		});

		it("should mark failed after max retries", () => {
			const config: Partial<RetryConfig> = { maxRetries: 1 };
			manager = new ConnectionRetryManager(config);

			manager.recordError("Error 1");
			expect(manager.getStatus()).toBe("failed");
		});
	});

	describe("progress tracking", () => {
		it("should calculate progress percentage", async () => {
			const config: Partial<RetryConfig> = { maxRetries: 4 };
			manager = new ConnectionRetryManager(config);

			expect(manager.getProgress()).toBe(0);

			await manager.waitForRetry();
			expect(manager.getProgress()).toBe(25);

			await manager.waitForRetry();
			expect(manager.getProgress()).toBe(50);
		});
	});

	describe("display info", () => {
		it("should provide display info for UI", async () => {
			await manager.waitForRetry();

			const info = manager.getDisplayInfo();
			expect(info.status).toBe("reconnecting");
			expect(info.attempt).toBe(1);
			expect(info.maxRetries).toBe(DEFAULT_RETRY_CONFIG.maxRetries);
			expect(info.nextDelaySeconds).toBeGreaterThan(0);
			expect(info.isRetrying).toBe(true);
		});
	});

	describe("abort functionality", () => {
		it("should support abort during wait", async () => {
			const config: Partial<RetryConfig> = { initialDelayMs: 5000 };
			manager = new ConnectionRetryManager(config);

			const waitPromise = manager.waitForRetry();
			manager.abort();

			const result = await waitPromise;
			expect(result).toBe(false);
		});
	});
});

describe("createConnectionRetryManager", () => {
	it("should create manager with default config", () => {
		const manager = createConnectionRetryManager();
		expect(manager).toBeInstanceOf(ConnectionRetryManager);
		expect(manager.getState().nextDelayMs).toBe(DEFAULT_RETRY_CONFIG.initialDelayMs);
	});

	it("should create manager with custom config", () => {
		const manager = createConnectionRetryManager({ maxRetries: 10 });
		expect(manager.getDisplayInfo().maxRetries).toBe(10);
	});
});

describe("retryWithBackoff", () => {
	it("should succeed on first attempt", async () => {
		const fn = vi.fn().mockResolvedValue("success");
		const result = await retryWithBackoff(fn, { maxRetries: 3 });

		expect(result).toBe("success");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("should retry on failure and eventually succeed", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockResolvedValue("success");

		const result = await retryWithBackoff(fn, {
			maxRetries: 3,
			initialDelayMs: 10,
			backoffMultiplier: 1,
		});

		expect(result).toBe("success");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("should throw after max retries exceeded", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("always fails"));

		await expect(
			retryWithBackoff(fn, {
				maxRetries: 2,
				initialDelayMs: 10,
				backoffMultiplier: 1,
			}),
		).rejects.toThrow("Failed after 2 attempts: always fails");

		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("should handle non-error rejections", async () => {
		const fn = vi.fn().mockRejectedValue("string error");

		await expect(
			retryWithBackoff(fn, {
				maxRetries: 1,
				initialDelayMs: 10,
			}),
		).rejects.toThrow("Failed after 1 attempts");
	});
});
