import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let context:
	| {
			queryClient: QueryClient;
	  }
	| undefined;

export function getContext() {
	if (context) {
		return context;
	}

	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				// Refetch when window regains focus
				refetchOnWindowFocus: true,
				// Refetch when network reconnects
				refetchOnReconnect: true,
				// Retry failed requests 3 times with exponential backoff
				retry: 3,
				retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
				// Data is considered fresh for 5 minutes (300 seconds)
				staleTime: 5 * 60 * 1000,
				// Keep inactive data in cache for 10 minutes
				gcTime: 10 * 60 * 1000,
				// Only run queries when online
				networkMode: "online",
			},
		},
	});

	context = {
		queryClient,
	};

	return context;
}

export default function TanStackQueryProvider({
	children,
}: {
	children: ReactNode;
}) {
	const { queryClient } = getContext();

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
