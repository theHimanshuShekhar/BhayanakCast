import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

/** Router context available to every route's `beforeLoad` and `loader`. */
export interface RouterContext {
  queryClient: QueryClient;
}

// Called once per SSR request and once in the browser, so each request gets its own cache.
export function getRouter() {
  const queryClient = new QueryClient({
    // Data is correct on load and navigation; live changes arrive as invalidations (spec #3).
    // Long enough that hydration doesn't refetch what SSR just loaded.
    defaultOptions: { queries: { staleTime: 30_000 } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultNotFoundComponent: () => <h1>Not found</h1>,
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
