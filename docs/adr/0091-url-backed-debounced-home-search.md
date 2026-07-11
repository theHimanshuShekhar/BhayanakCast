# ADR 0091: Make Home search debounced and URL-backed

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home search is a primary discovery interaction. It should respond while users explore partial terms, while reload, sharing, and browser navigation must reproduce the visible query/filter context.

## Decision

Home executes text search after a 250 ms pause in normalized input; Enter executes immediately. Category and tag changes execute immediately. Query, selected category, and selected tags are encoded in canonical Home URL search parameters.

Implement the delay with TanStack Pacer `useDebouncer`, trailing with `wait: 250`. Input calls `maybeExecute`, Enter calls `flush`, and default unmount behavior cancels pending navigation. Subscribe only to `isPending` for the localized debounce status. The callback performs canonical URL navigation.

Typing and filter changes replace the current history entry rather than creating one entry per keystroke. Clearing a value removes its parameter. Reloading or opening a shared URL restores controls and results from those parameters before showing the normal unfiltered Home sections.

TanStack Query owns search fetching/cache. Canonical normalized parameters form query keys; each query function forwards Query's `AbortSignal`, and v5 uses `placeholderData: keepPreviousData` plus `isPlaceholderData` to retain the prior successful result while a new key loads. TanStack Start owns route navigation and SSR hydration; Query cancellation prevents superseded work from overwriting the active projection.

## Consequences

- Search/filter views are shareable and survive reload and return navigation.
- Browser history is not polluted by intermediate typing states.
- Server-rendered and client transitions must interpret the same canonical parameters and reject/normalize invalid or duplicate values consistently.
- Search result announcements must be accessible without moving keyboard focus on every debounced response.
