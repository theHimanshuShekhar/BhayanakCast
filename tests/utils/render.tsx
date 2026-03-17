import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender } from "@testing-library/react";
import type { ReactElement } from "react";
import { createContext } from "react";
import type { Socket } from "socket.io-client";

// Mock WebSocket context for tests
export const MockWebSocketContext = createContext<{
	socket: Socket | null;
	isConnected: boolean;
	userCount: number;
	userId: string | null;
	currentRoomId: string | null;
	setCurrentRoomId: (roomId: string | null) => void;
	sendMessage: (message: unknown) => void;
}>({
	socket: null,
	isConnected: true,
	userCount: 1,
	userId: "test-user",
	currentRoomId: null,
	setCurrentRoomId: () => {},
	sendMessage: () => {},
});

interface RenderOptions {
	queryClient?: QueryClient;
	withWebSocket?: boolean;
}

export function render(ui: ReactElement, options: RenderOptions = {}) {
	const queryClient =
		options.queryClient ||
		new QueryClient({
			defaultOptions: {
				queries: {
					// Disable retries in tests for faster failure
					retry: false,
					// Disable garbage collection in tests
					gcTime: 0,
					// Disable window focus refetching in tests
					refetchOnWindowFocus: false,
					// Disable reconnect refetching in tests
					refetchOnReconnect: false,
				},
			},
		});

	function Wrapper({ children }: { children: React.ReactNode }) {
		if (options.withWebSocket) {
			return (
				<QueryClientProvider client={queryClient}>
					<MockWebSocketContext.Provider
						value={{
							socket: null,
							isConnected: true,
							userCount: 1,
							userId: "test-user",
							currentRoomId: null,
							setCurrentRoomId: () => {},
							sendMessage: () => {},
						}}
					>
						{children}
					</MockWebSocketContext.Provider>
				</QueryClientProvider>
			);
		}

		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	}

	return {
		...rtlRender(ui, { wrapper: Wrapper }),
		queryClient,
	};
}
