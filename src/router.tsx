import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { ServerRequest } from "srvx";
import { CSP_NONCE_KEY } from "./lib/csp-nonce";
import { routeTree } from "./routeTree.gen";

// The nonce server.prod.ts made for this request (src/server/security-headers.ts); none in
// `pnpm dev`, which sends no CSP. Start renders it into a `csp-nonce` meta tag, and in the
// browser hydration reads it back into `ssr.nonce`, so inline scripts the client inserts
// carry it too; the browser branch here only gives the router a value to start from.
const requestNonce = createIsomorphicFn()
  .server(() => {
    const nonce = (getRequest() as ServerRequest).context?.[CSP_NONCE_KEY];
    return typeof nonce === "string" ? nonce : undefined;
  })
  .client(() => undefined);

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
    ssr: { nonce: requestNonce() },
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
