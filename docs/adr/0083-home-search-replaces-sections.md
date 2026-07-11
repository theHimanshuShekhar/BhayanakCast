# ADR 0083: Replace Home room sections while searching

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home search covers Active Rooms and public profiles but excludes Past Streams. Showing results as a popover or alongside the normal discovery feed would create competing information hierarchies and cramped room-state presentation.

## Decision

When Home contains a non-empty search query, keep the search/filter utility fixed and replace the normal featured Live Room, ranked Live Rooms, and Past Streams sections with two visibly separate uniform result groups: Active Rooms and Public Profiles.

Category/tag filters affect only the Active Rooms result group. Clearing the query restores the normal featured/ranked Live Rooms and ten recent Past Streams. Search never gives a room featured treatment.

## Consequences

- Left and right desktop rails, or their mobile replacements, remain available during search.
- Each group owns independent empty/loading state while preserving one page-level query.
- V1 does not add an autocomplete result popover or separate search-results route.
