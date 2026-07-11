# ADR 0089: Use an editorial Live Rooms grid

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

The homepage should feel like an active clubhouse rather than a plain directory. The stable featured-room assignment permits a stronger mixed composition without moving that large surface in response to every live rank change.

## Decision

At wide widths, the Live Rooms section starts with an editorial grid: the featured rank-1 card occupies the left side and spans the height of two smaller cards; ranks 2 and 3 stack on the right. Rank 4 onward continues below in a two-column grid of equal-size normal cards.

At medium widths, place the featured card full-width above a two-column grid of the remaining rooms. At small widths, use one column in rank order, with the featured card first and larger only through its internal emphasis rather than an asymmetric span.

Card size communicates the frozen presentation rank only: ranks 4 onward remain equal-size. Existing anti-churn rules freeze feature assignment and displayed order until a documented recomputation trigger, including one successful canonical refresh after realtime reconnection. A room ending closes its grid cell immediately but does not promote or reorder another card mid-visit. Search results remain a uniform list.

## Consequences

- The first three rooms form a stronger editorial opening while every additional room remains directly discoverable.
- The grid must preserve DOM rank order regardless of visual placement and must not use masonry ordering.
- With only one or two rooms, occupied cards use the available grid area without rendering empty placeholders.
