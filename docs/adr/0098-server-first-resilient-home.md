# ADR 0098: Render Home server-first with section-level recovery

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home combines discovery, bounded history, global statistics, search, and realtime updates. A failure in a secondary section must not block room discovery, while silent realtime loss would make live capacity/privacy/count state appear trustworthy when stale.

## Decision

TanStack Query owns every Home domain fetch/cache. The route loader blocks on `ensureQueryData` for discovery/search and visible Past Streams so useful/indexable content is server-rendered and hydrated without a duplicate browser fetch. Facets, statistics, and connected presence prefetch non-blockingly into shape-matched section skeletons. Debounced search preserves prior results through Query placeholder data and localized Pacer/Query pending state. Never replace the entire page for a section request or render missing/failed statistics as zero.

Each independently recoverable Query observer shows concise inline failure copy and refetches its exact key on Retry while unaffected navigation, discovery/history, or actions remain usable. Fatal shell/session errors use the route error boundary; Better Auth—not Query—continues to own session state.

After initial load, realtime loss is non-blocking. Keep the last rendered rooms/statistics but show a visible “Reconnecting…” status beside the search/presence utility and mark live values stale. Socket.IO retries automatically. Room-card navigation remains available because pre-admission revalidates current room/admission state. On reconnect, invalidate `['home']`, refetch active Query observers, and recompute displayed rank/feature once after canonical refresh succeeds; then remove the stale status.

## Consequences

- Statistics or profile-preview failures do not erase usable room discovery.
- Skeleton dimensions must reflect real card/list geometry and respect reduced motion.
- Users can distinguish stale live state from current state without losing navigation.
- Reconnect recovery may visibly reorder the editorial grid once, which is preferable to preserving an unknown stale rank indefinitely.
- Focus stays in place through progress, section retry, disconnect, and reconnect updates; status changes use polite announcements.
