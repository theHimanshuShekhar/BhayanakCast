# ADR 0080: Feature the leading Live Room without live reordering

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home should feel socially alive and give the strongest current room a clear entry point. Realtime ranking changes, however, must not move large surfaces while someone is scanning or preparing to select a room.

## Decision

The normal Live Rooms view gives the highest-ranked room a larger featured treatment. Its exact wide, medium, and small placement follows ADR 0089; DOM and visual order always preserve rank.

Member/Stream counts, state, and other room data update live, but feature assignment and list order remain stable during the current Home visit. Recompute ranking on page reload, navigation back to Home, filter change, cleared/changed search context, explicit refresh, or a successful canonical refresh after realtime reconnection.

Search results use a uniform result list rather than featured treatment.

## Consequences

- A room that ends disappears immediately; the remaining layout closes the gap without promoting a new featured room until the next recomputation trigger.
- A room becoming Full/private or otherwise changing state updates in place without moving.
- The featured surface may temporarily differ from the current server ranking; this is an intentional anti-churn presentation rule, not a data-staleness promise.
