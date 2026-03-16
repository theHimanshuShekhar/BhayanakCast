/**
 * Rate Limiting System with Adapter Pattern
 *
 * Supports multiple backends:
 * - InMemoryBackend: Single-server, ephemeral (default)
 * - ValkeyBackend: Multi-server, persistent (future)
 *
 * Usage:
 *   const limiter = RateLimiter.getInstance();
 *   const result = limiter.check(userId, { windowMs: 60000, maxAttempts: 3 });
 *   if (!result.allowed) throw new Error(`Rate limited. Try again in ${result.retryAfter}s`);
 */

export interface RateLimitConfig {
	/** Time window in milliseconds */
	windowMs: number;
	/** Maximum attempts allowed in window */
	maxAttempts: number;
	/** Optional key prefix for namespacing */
	keyPrefix?: string;
}

export interface RateLimitResult {
	/** Whether the request is allowed */
	allowed: boolean;
	/** Remaining attempts in current window */
	remaining: number;
	/** Timestamp when the window resets (ms since epoch) */
	resetAt: number;
	/** Seconds until retry (0 if allowed) */
	retryAfter: number;
	/** Total attempts made in current window */
	totalAttempts: number;
}

/**
 * Backend interface - implement this for different storage systems
 */
export interface RateLimiterBackend {
	/**
	 * Check if request is allowed without recording it
	 */
	check(key: string, config: RateLimitConfig): RateLimitResult;

	/**
	 * Record an attempt and check if allowed
	 */
	record(key: string, config: RateLimitConfig): RateLimitResult;

	/**
	 * Reset rate limit for a specific key
	 */
	reset(key: string): void;

	/**
	 * Reset all rate limits (mainly for testing)
	 */
	resetAll(): void;
}

/**
 * In-memory implementation using Maps
 * Suitable for single-server deployments
 */
export class InMemoryBackend implements RateLimiterBackend {
	// Map<key, Array<timestamp>>
	private attempts: Map<string, number[]> = new Map();

	check(key: string, config: RateLimitConfig): RateLimitResult {
		const now = Date.now();
		const fullKey = this.getFullKey(key, config.keyPrefix);
		const userAttempts = this.attempts.get(fullKey) || [];

		// Filter to only recent attempts within window
		const windowStart = now - config.windowMs;
		const recentAttempts = userAttempts.filter((ts) => ts > windowStart);

		const totalAttempts = recentAttempts.length;
		const remaining = Math.max(0, config.maxAttempts - totalAttempts);
		const allowed = totalAttempts <= config.maxAttempts;

		// Calculate reset time (oldest attempt in window + window duration, or now + window if empty)
		const resetAt =
			recentAttempts.length > 0
				? recentAttempts[0] + config.windowMs
				: now + config.windowMs;

		const retryAfter = allowed ? 0 : Math.ceil((resetAt - now) / 1000);

		return {
			allowed,
			remaining,
			resetAt,
			retryAfter,
			totalAttempts,
		};
	}

	record(key: string, config: RateLimitConfig): RateLimitResult {
		const fullKey = this.getFullKey(key, config.keyPrefix);
		const now = Date.now();

		// Get existing attempts
		const existing = this.attempts.get(fullKey) || [];

		// Filter old attempts
		const windowStart = now - config.windowMs;
		const recentAttempts = existing.filter((ts) => ts > windowStart);

		// Add new attempt
		recentAttempts.push(now);
		this.attempts.set(fullKey, recentAttempts);

		// Return updated status
		return this.check(key, config);
	}

	reset(key: string): void {
		// Remove all attempts with this key (regardless of prefix)
		for (const [mapKey] of this.attempts) {
			if (mapKey.endsWith(`:${key}`) || mapKey === key) {
				this.attempts.delete(mapKey);
			}
		}
	}

	resetAll(): void {
		this.attempts.clear();
	}

	private getFullKey(key: string, prefix?: string): string {
		return prefix ? `${prefix}:${key}` : key;
	}
}

/**
 * Valkey/Redis backend stub
 * Implement this when migrating to multi-server setup
 */
export class ValkeyBackend implements RateLimiterBackend {
	private client: unknown; // Will be Redis/Valkey client

	constructor(_connectionUrl?: string) {
		// TODO: Initialize Valkey client
		throw new Error(
			"ValkeyBackend not yet implemented. Use InMemoryBackend for now.",
		);
	}

	check(_key: string, _config: RateLimitConfig): RateLimitResult {
		throw new Error("Not implemented");
	}

	record(_key: string, _config: RateLimitConfig): RateLimitResult {
		throw new Error("Not implemented");
	}

	reset(_key: string): void {
		throw new Error("Not implemented");
	}

	resetAll(): void {
		throw new Error("Not implemented");
	}
}

/**
 * Main RateLimiter class - singleton for application-wide use
 */
export class RateLimiter {
	private static instance: RateLimiter | null = null;
	private backend: RateLimiterBackend;

	constructor(backend?: RateLimiterBackend) {
		this.backend = backend || new InMemoryBackend();
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(backend?: RateLimiterBackend): RateLimiter {
		if (!RateLimiter.instance) {
			RateLimiter.instance = new RateLimiter(backend);
		}
		return RateLimiter.instance;
	}

	/**
	 * Reset singleton instance (useful for testing)
	 */
	static resetInstance(): void {
		RateLimiter.instance = null;
	}

	/**
	 * Check if action is allowed without consuming quota
	 */
	check(key: string, config: RateLimitConfig): RateLimitResult {
		return this.backend.check(key, config);
	}

	/**
	 * Record an attempt and return result
	 */
	record(key: string, config: RateLimitConfig): RateLimitResult {
		return this.backend.record(key, config);
	}

	/**
	 * Check and record in one call (most common use case)
	 * Returns result after recording attempt
	 */
	checkAndRecord(key: string, config: RateLimitConfig): RateLimitResult {
		return this.backend.record(key, config);
	}

	/**
	 * Reset rate limit for a specific key
	 */
	reset(key: string): void {
		this.backend.reset(key);
	}

	/**
	 * Reset all rate limits
	 */
	resetAll(): void {
		this.backend.resetAll();
	}

	/**
	 * Create a namespaced limiter for specific actions
	 */
	forAction(action: string): ActionRateLimiter {
		return new ActionRateLimiter(this, action);
	}
}

/**
 * Convenience class for namespaced actions
 */
export class ActionRateLimiter {
	constructor(
		private limiter: RateLimiter,
		private action: string,
	) {}

	check(key: string, config: RateLimitConfig): RateLimitResult {
		return this.limiter.check(key, {
			...config,
			keyPrefix: this.action,
		});
	}

	record(key: string, config: RateLimitConfig): RateLimitResult {
		return this.limiter.record(key, {
			...config,
			keyPrefix: this.action,
		});
	}

	checkAndRecord(key: string, config: RateLimitConfig): RateLimitResult {
		return this.limiter.checkAndRecord(key, {
			...config,
			keyPrefix: this.action,
		});
	}

	reset(key: string): void {
		this.limiter.reset(key);
	}
}

/**
 * Predefined rate limit configurations
 *
 * TUNING PHILOSOPHY:
 * - Err on the side of permissive for legitimate users
 * - Tight limits for expensive operations (DB writes, room creation)
 * - Moderate limits for chat/active usage (allows bursts)
 * - Generous limits for connection/shared IP scenarios
 * - All limits include clear retry messaging
 *
 * REFERENCE:
 * - Burst: Short window for immediate action throttling
 * * Sustained: Longer window for overall usage patterns
 * - Deny list: Progressive penalties for repeat offenders
 */
export const RateLimits = {
	// ==================== ROOM OPERATIONS ====================

	/**
	 * Room creation: 3 rooms per minute
	 * Rationale: Expensive DB operation, but power users might create a few quickly
	 * Impact: Creates DB records, sets up WebSocket rooms
	 */
	ROOM_CREATE: { windowMs: 60 * 1000, maxAttempts: 3 } as RateLimitConfig,

	/**
	 * Room joins: 10 joins per minute (was 5)
	 * Rationale: Users browsing rooms should be able to check 10 rooms/min comfortably
	 * Edge case: Shared IPs, connection drops, legitimate exploration
	 * Impact: DB writes to room_participants, WebSocket room joins
	 */
	ROOM_JOIN: { windowMs: 60 * 1000, maxAttempts: 10 } as RateLimitConfig,

	/**
	 * Room leaves: 5 leaves per minute
	 * Rationale: Less common than joins, but allow for quick browsing
	 * Impact: DB updates, triggers streamer transfer logic
	 */
	ROOM_LEAVE: { windowMs: 60 * 1000, maxAttempts: 5 } as RateLimitConfig,

	// ==================== CHAT & MESSAGING ====================

	/**
	 * Chat messages: 30 messages per 15 seconds
	 * Rationale: Allows active conversation (2 msg/sec) but blocks spam bots
	 * Burst: 30 in 15s | Sustained: ~120/min max
	 * Legitimate use: Active conversation, reactions, multi-part messages
	 * Abuse: Spam bots typically send 100+ msg/min
	 */
	CHAT_SEND: { windowMs: 15 * 1000, maxAttempts: 30 } as RateLimitConfig,

	/**
	 * Chat rapid-fire (additional protection): 5 messages per 3 seconds
	 * Rationale: Prevents copy-paste spam and macro abuse
	 * Applied separately to catch micro-bursts
	 */
	CHAT_RAPID: { windowMs: 3 * 1000, maxAttempts: 5 } as RateLimitConfig,

	// ==================== STREAMER OPERATIONS ====================

	/**
	 * Streamer transfer: 1 transfer per 30 seconds
	 * Rationale: Streamer changes should be deliberate, prevents trolling
	 * Impact: Updates room ownership, broadcasts to all participants
	 */
	STREAMER_TRANSFER: { windowMs: 30 * 1000, maxAttempts: 1 } as RateLimitConfig,

	// ==================== DATA FETCHING ====================

	/**
	 * Search queries: 60 searches per minute (was 30)
	 * Rationale: Typing in search box + autocomplete = many requests
	 * 60/min = 1/sec average, allows for fast typists
	 * Impact: DB queries on streaming_rooms table
	 */
	SEARCH: { windowMs: 60 * 1000, maxAttempts: 60 } as RateLimitConfig,

	/**
	 * Profile views: 120 views per minute (was 60)
	 * Rationale: Users clicking through multiple profiles quickly
	 * 120/min = 2/sec, reasonable for browsing
	 * Impact: DB queries on users + relationships tables
	 */
	PROFILE_VIEW: { windowMs: 60 * 1000, maxAttempts: 120 } as RateLimitConfig,

	/**
	 * Home/room list refreshes: 20 per minute
	 * Rationale: Users refreshing to see new rooms
	 * Prevents excessive polling while allowing legitimate use
	 */
	HOME_REFRESH: { windowMs: 60 * 1000, maxAttempts: 20 } as RateLimitConfig,

	// ==================== CONNECTION & AUTH ====================

	/**
	 * WebSocket connections: 30 per minute per IP (was 10)
	 * Rationale: Must account for:
	 *   - Connection instability (user reconnects 3-5 times)
	 *   - Shared networks (offices, cafes, universities)
	 *   - Multiple browser tabs
	 * 30/min = 1 every 2 seconds, generous but catches DDoS
	 * Impact: Server resources, memory per connection
	 */
	WS_CONNECTION: { windowMs: 60 * 1000, maxAttempts: 30 } as RateLimitConfig,

	/**
	 * Authentication attempts: 5 per 15 minutes
	 * Rationale: Prevents brute force while allowing retry after typos
	 * Applied per IP to prevent credential stuffing
	 * Impact: Auth service load, security
	 */
	AUTH_ATTEMPT: { windowMs: 15 * 60 * 1000, maxAttempts: 5 } as RateLimitConfig,

	// ==================== PROGRESSIVE PENALTIES ====================

	/**
	 * Repeated violations penalty window
	 * If user hits 3+ different rate limits in 5 minutes, temp ban
	 * Used for deny-listing abusive behavior patterns
	 */
	VIOLATION_WINDOW: {
		windowMs: 5 * 60 * 1000,
		maxAttempts: 3,
	} as RateLimitConfig,
} as const;

/**
 * Global rate limiter instance
 */
export const rateLimiter = RateLimiter.getInstance();
