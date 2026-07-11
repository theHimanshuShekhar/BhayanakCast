# ADR 0099: Use TanStack Query for all Home domain data

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home reads Active Rooms/search results, rich Public Profile results, recent Past Streams, category/tag facets, global statistics, and connected presence. These sections need server rendering, browser cache reuse, independent recovery, URL-keyed search results, stale revalidation, request cancellation, and Socket.IO synchronization. Ad hoc route fetches plus component fetches would create duplicate requests and competing caches.

Better Auth already owns session/account state and must remain the sole authentication cache rather than being wrapped in a second Query cache.

## Decision

Use TanStack Query v5 (`@tanstack/react-query`) as the only fetching/cache boundary for Home domain data. Home components and route loaders do not call domain HTTP/server functions outside reusable `queryOptions` definitions. Better Auth session/account state is the explicit exception and remains owned by Better Auth.

### Query client and SSR

Create a fresh `QueryClient` for every server request and one stable browser `QueryClient`. Pass it through TanStack Start router context and call `setupRouterSsrQueryIntegration({ router, queryClient })` in the per-request router factory so the browser reuses the streamed/dehydrated server cache without an immediate duplicate fetch.

The Home route loader calls `ensureQueryData` for the critical Active Rooms/search projection and for Past Streams when that section is shown. These queries block the initial response so discovery and indexable content are present in server-rendered HTML. Start non-blocking `prefetchQuery` work for facets, statistics, and connected presence; their query components own shape-matched section skeletons and independent error recovery. Do not fetch the same payload separately into route-loader data.

Every query function consumes the `AbortSignal` supplied in `QueryFunctionContext` and forwards it to the underlying request/server-function boundary. Superseded URL navigation and unmounted observers therefore cancel obsolete work rather than allowing stale completion to win.

### Query keys

Use one key factory and canonical, serializable parameters:

- `['home', 'rooms', { query, category, tags }]` — Active Rooms or normal discovery; tags are normalized, deduplicated, and sorted before key creation.
- `['home', 'profiles', { query }]` — enabled only for a non-empty normalized text query; room filters never enter this key.
- `['home', 'past-streams']` — ten newest Past Streams, enabled only where the normal Home section is rendered.
- `['home', 'facets']` — normalized distinct category/tag values and current counts.
- `['home', 'statistics', { operatorDay }]` — global Home metrics for the configured operator-day key.
- `['home', 'presence']` — current distinct connected signed-in Account count.

Canonical URL parsing is the only source for query/category/tags. Query keys never contain raw `URLSearchParams`, functions, mutable objects, private passwords, Account session data, or presentation-only state.

### Freshness and retention

Use explicit per-query policies:

| Query | `staleTime` |
| --- | ---: |
| Rooms/discovery | 15 seconds |
| Connected presence | 15 seconds |
| Facets | 30 seconds |
| Statistics | 30 seconds |
| Profile search | 60 seconds |
| Past Streams | 60 seconds |

All Home queries use `gcTime: 10 minutes`. Keep stale-on-trigger behavior: stale active queries refetch on mount, window focus, and network reconnect; canonical URL changes create/select the corresponding key; explicit section Retry refetches that key. Do not configure `refetchInterval`: Socket.IO supplies live changes without duplicate polling. Server rendering performs no automatic retry. In the browser, retry network/5xx failures at most twice with bounded delay; do not retry validation, authentication, authorization, not-found, or other deterministic 4xx results.

Search transitions use `placeholderData`/the v5 `keepPreviousData` helper so the prior successful projection remains visible while the next URL-keyed query is pending. A placeholder never changes the canonical key or masquerades as fresh data.

### Socket.IO and invalidation

Socket.IO remains the source of realtime events; TanStack Query remains the only Home server-state cache. Use a hybrid synchronization rule:

- Apply immutable `setQueriesData` updates to existing cached room projections for value-only changes that do not affect result membership: member/Stream counts, Full/live state, latest Stream Preview, and other permitted room fields. The Home presentation snapshot preserves its displayed order through these count updates. If an updater receives `undefined`, return `undefined` rather than creating speculative cache entries.
- Invalidate targeted key prefixes when an event can add, remove, or rematch a result: room create/end/revival, room name/category/tag/visibility change, or safety-driven discovery removal. Also invalidate facets/statistics/Past Streams prefixes when their source facts changed. Do not invalidate room lists merely because a count changed; update the count while retaining the documented anti-churn order.
- Do not reproduce fuzzy search, privacy projection, facet counting, or full ranking logic in browser cache updaters. Targeted invalidation lets the server remain authoritative. A stale-trigger refetch may refresh canonical ranking data, but the current Home presentation order remains frozen until an existing documented recomputation trigger.
- On realtime reconnect, invalidate all `['home']` queries and refetch active observers. Keep the documented stale/reconnecting indicator until the active canonical queries succeed, then recompute the stable featured/grid assignment once.

Use exact invalidation for one known parameterized key and prefix invalidation for all cached variants of a section. Never invalidate the entire application Query cache for a Home event.

### Mutations

Home Create Room and other server writes use TanStack Query mutations where they touch Home domain data. Successful mutations patch returned canonical entities where safe, then invalidate the same targeted prefixes as equivalent Socket.IO events. Mutation pending state prevents duplicate submission; TanStack Pacer is not used for one-shot mutation protection.

## Consequences

- Back/forward navigation, repeated searches, and return-to-Home reuse cached section data until a documented stale trigger revalidates it.
- Section-level loading/error behavior aligns with independent Query observers rather than one composite failure boundary.
- SSR and client rendering share query definitions and one hydrated cache, eliminating loader/component double fetching.
- Socket.IO delivers immediate changes without forcing polling or duplicating server search logic in the browser.
- Query cache contents remain public Home projections only; Better Auth and private room/account state retain their existing owners.
- Focused tests must cover canonical key normalization, SSR hydration without duplicate fetch, stale trigger behavior, request abort, previous-search placeholder behavior, targeted Socket.IO patch/invalidation, reconnect refetch, and independent section errors.
