import { QueryClient } from '@tanstack/react-query'
import {
  createRouter,
  defaultParseSearch,
  defaultStringifySearch,
} from '@tanstack/react-router'
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
    parseSearch: parseCanonicalSearch,
    stringifySearch: stringifyCanonicalSearch,
    scrollRestoration: true,
  })
  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

export function parseCanonicalSearch(search: string) {
  const parsed = defaultParseSearch(search) as Record<string, unknown>
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  if (params.has('tags')) parsed.tags = params.getAll('tags')
  return parsed
}

export function stringifyCanonicalSearch(search: Record<string, unknown>) {
  const { tags, ...other } = search
  const params = new URLSearchParams(defaultStringifySearch(other))
  if (Array.isArray(tags)) {
    for (const tag of tags) params.append('tags', String(tag))
  } else if (tags !== undefined) {
    params.set('tags', String(tags))
  }
  const value = params.toString()
  return value ? `?${value}` : ''
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
