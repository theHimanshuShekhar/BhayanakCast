# ADR 0053: Show ten recent Past Streams below Live Rooms

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Past Streams provide lightweight community continuity but are non-replayable historical records, not a second discovery catalog.

## Decision

The home/discovery page shows a fixed section of the ten most recently ended Past Streams below its Live Rooms section. The section remains available when Live Rooms are empty. Past Streams have no in-app search, pagination, dedicated browse surface, or replay media.

## Consequences

- The primary home hierarchy remains Live Rooms first.
- The home query orders Past Streams by end time descending and caps the result at ten.
- A Past Stream's direct page remains noindex while its public metadata can appear in this bounded home section and documented public profiles.
