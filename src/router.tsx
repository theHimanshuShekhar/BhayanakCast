import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          typeof window !== 'undefined' && failureCount < 2 && retryableHomeError(error),
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
      },
    },
  })
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
  })
  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

export function retryableHomeError(error: unknown) {
  if (error && typeof error === 'object' && 'status' in error) {
    return typeof error.status === 'number' && error.status >= 500
  }
  return error instanceof Error
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
