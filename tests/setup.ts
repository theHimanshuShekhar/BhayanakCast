import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { RateLimiter } from "#/lib/rate-limiter";

// Mock environment variables
vi.mock("import.meta.env", () => ({
	VITE_WS_URL: "http://localhost:3001",
	VITE_BETTER_AUTH_URL: "http://localhost:3000",
}));

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// Mock localStorage
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
};
Object.defineProperty(window, "localStorage", {
	value: localStorageMock,
});

// Mock crypto.randomUUID - return unique values each call
let uuidCounter = 0;
Object.defineProperty(globalThis, "crypto", {
	value: {
		randomUUID: () => `test-uuid-${Date.now()}-${++uuidCounter}`,
	},
});

// Mock IntersectionObserver
class MockIntersectionObserver {
	observe = vi.fn();
	disconnect = vi.fn();
	unobserve = vi.fn();
}
Object.defineProperty(window, "IntersectionObserver", {
	writable: true,
	configurable: true,
	value: MockIntersectionObserver,
});

// Cleanup after each test
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	// Note: Rate limiter reset is now handled by individual tests that need it
	// This avoids interference between tests that manage their own rate limiters
	// and tests that use the global instance
	// Reset modules to clear in-memory state
	vi.resetModules();
});
