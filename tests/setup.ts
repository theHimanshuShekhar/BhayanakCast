import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

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

// Mock crypto.randomUUID
Object.defineProperty(globalThis, "crypto", {
	value: {
		randomUUID: () => "test-uuid-12345",
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
	// Reset modules to clear in-memory state (rate limiters, cooldowns, etc.)
	vi.resetModules();
});
