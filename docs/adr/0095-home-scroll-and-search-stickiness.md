# ADR 0095: Use one page scroll and pin search only while active

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home has persistent rail actions and potentially many room/profile results. Independent column scrolling would introduce nested scroll regions, while permanently pinning the full search/filter block would consume too much viewport space.

## Decision

Home uses one normal document scroll. At wide widths, both rails are sticky, viewport-height companions while the center and document scroll together. At medium widths, the retained left rail follows the same behavior. Rail content must fit common short viewports; if it cannot, it joins normal document flow rather than creating its own scroll region.

The center search/filter utility scrolls normally during unfiltered discovery. When any query, category, or tag is active, it becomes sticky so controls remain available while scanning results. On small widths it pins below the fixed top brand bar and respects safe-area/stacking offsets. Clearing every search/filter returns it to normal flow.

The active sticky state preserves the same controls and dimensions where practical; it does not switch to a second compact component, obscure focus, or cover anchored content. Bottom navigation remains separately fixed on small widths.

## Consequences

- Home has one primary scroll container and predictable keyboard/page navigation.
- Persistent rail actions remain available without forcing scrollbars into each column.
- Search controls stay reachable exactly when users need to refine results, but do not occupy the viewport during ordinary browsing.
- Sticky offsets and focus scroll margins require coverage at wide, medium, and small stages.
