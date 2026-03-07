import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender } from "@testing-library/react";
import type { ReactElement } from "react";

interface RenderOptions {
	queryClient?: QueryClient;
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
		return (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
	}

	return {
		...rtlRender(ui, { wrapper: Wrapper }),
		queryClient,
	};
}
