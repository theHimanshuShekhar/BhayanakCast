/**
 * Connection Retry Manager
 *
 * Implements exponential backoff retry logic for PeerJS connections
 * with jitter to prevent thundering herd.
 *
 * @module lib/connection-retry
 */

export interface RetryConfig {
	maxRetries: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
	jitterFactor: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 5,
	initialDelayMs: 1000,
	maxDelayMs: 30000,
	backoffMultiplier: 2,
	jitterFactor: 0.1,
};

export type ConnectionStatus =
	| "idle"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "failed";

export interface RetryState {
	attempt: number;
	status: ConnectionStatus;
	nextDelayMs: number;
	lastError?: string;
}

export class ConnectionRetryManager {
	private config: RetryConfig;
	private state: RetryState;
	private abortController: AbortController | null = null;

	constructor(config: Partial<RetryConfig> = {}) {
		this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
		this.state = {
			attempt: 0,
			status: "idle",
			nextDelayMs: this.config.initialDelayMs,
		};
	}

	/**
	 * Get current retry state
	 */
	getState(): RetryState {
		return { ...this.state };
	}

	/**
	 * Get current connection status
	 */
	getStatus(): ConnectionStatus {
		return this.state.status;
	}

	/**
	 * Check if we should retry
	 */
	shouldRetry(): boolean {
		return this.state.attempt < this.config.maxRetries;
	}

	/**
	 * Calculate next delay with exponential backoff and jitter
	 */
	private calculateNextDelay(): number {
		const baseDelay = Math.min(
			this.state.nextDelayMs * this.config.backoffMultiplier,
			this.config.maxDelayMs,
		);
		const jitter =
			baseDelay * this.config.jitterFactor * (Math.random() * 2 - 1);
		return Math.max(this.config.initialDelayMs, baseDelay + jitter);
	}

	/*
	 * Wait for the calculated delay
	 */
	async waitForRetry(): Promise<boolean> {
		if (!this.shouldRetry()) {
			this.state.status = "failed";
			return false;
		}

		this.state.status = "reconnecting";
		this.state.attempt++;

		const delay = this.state.nextDelayMs;
		this.state.nextDelayMs = this.calculateNextDelay();

		// Check if we should still retry after incrementing attempt
		if (!this.shouldRetry()) {
			this.state.status = "failed";
		}

		// Create new abort controller for this wait
		this.abortController = new AbortController();

		try {
			await this.sleep(delay, this.abortController.signal);
			return true;
		} catch {
			// Aborted
			return false;
		}
	}

	/**
	 * Sleep with abort support
	 */
	private sleep(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(resolve, ms);

			signal.addEventListener("abort", () => {
				clearTimeout(timeout);
				reject(new Error("Retry aborted"));
			});
		});
	}

	/**
	 * Mark connection as successful
	 */
	markSuccess(): void {
		this.state = {
			attempt: 0,
			status: "connected",
			nextDelayMs: this.config.initialDelayMs,
		};
	}

	/**
	 * Mark connection as failed
	 */
	markFailed(error: string): void {
		this.state.status = "failed";
		this.state.lastError = error;
	}

	/**
	 * Mark connection as starting
	 */
	markConnecting(): void {
		this.state.status = "connecting";
	}

	/**
	 * Record an error and prepare for retry
	 */
	recordError(error: string): void {
		this.state.lastError = error;
		// Check if this error exhausts all remaining attempts
		if (this.state.attempt + 1 >= this.config.maxRetries) {
			this.markFailed(error);
		}
	}

	/**
	 * Abort current retry operation
	 */
	abort(): void {
		this.abortController?.abort();
		this.abortController = null;
	}

	/**
	 * Reset to initial state
	 */
	reset(): void {
		this.abort();
		this.state = {
			attempt: 0,
			status: "idle",
			nextDelayMs: this.config.initialDelayMs,
		};
	}

	/**
	 * Get retry progress as percentage
	 */
	getProgress(): number {
		return (this.state.attempt / this.config.maxRetries) * 100;
	}

	/**
	 * Get formatted retry info for UI display
	 */
	getDisplayInfo(): {
		status: ConnectionStatus;
		attempt: number;
		maxRetries: number;
		nextDelaySeconds: number;
		isRetrying: boolean;
	} {
		return {
			status: this.state.status,
			attempt: this.state.attempt,
			maxRetries: this.config.maxRetries,
			nextDelaySeconds: Math.ceil(this.state.nextDelayMs / 1000),
			isRetrying: this.state.status === "reconnecting",
		};
	}
}

/**
 * Factory function to create retry manager
 */
export function createConnectionRetryManager(
	config?: Partial<RetryConfig>,
): ConnectionRetryManager {
	return new ConnectionRetryManager(config);
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	config: Partial<RetryConfig> = {},
): Promise<T> {
	const manager = new ConnectionRetryManager(config);
	const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

	while (manager.shouldRetry()) {
		try {
			manager.markConnecting();
			const result = await fn();
			manager.markSuccess();
			return result;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			manager.recordError(errorMessage);

			if (!manager.shouldRetry()) {
				throw new Error(
					`Failed after ${finalConfig.maxRetries} attempts: ${errorMessage}`,
				);
			}

			const shouldContinue = await manager.waitForRetry();
			if (!shouldContinue) {
				throw new Error("Retry aborted");
			}
		}
	}

	const lastError = manager.getState().lastError;
	throw new Error(`Failed after ${finalConfig.maxRetries} attempts${lastError ? `: ${lastError}` : ""}`);
}
