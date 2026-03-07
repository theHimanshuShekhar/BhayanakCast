import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";

export const createMockSocket = () => ({
	on: vi.fn(),
	emit: vi.fn(),
	disconnect: vi.fn(),
	connected: true,
	id: "socket-test-id",
});

export const mockSocketIo = vi.fn(() => createMockSocket());

export const createMockAuthClient = (session: any = null) => ({
	useSession: () => ({ data: session }),
	signIn: {
		social: vi.fn(),
	},
	signOut: vi.fn(),
});

export const createTestQueryClient = () => {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 0,
			},
		},
	});
};
