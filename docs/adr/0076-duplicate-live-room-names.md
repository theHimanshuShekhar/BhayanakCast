# ADR 0076: Allow duplicate live room names

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Room names are human-authored discovery metadata, while opaque room IDs are the stable identity and URL boundary. Enforcing uniqueness would add Unicode/case normalization, reservation, and concurrent-creation rules without preventing meaningful ambiguity.

## Decision

V1 allows multiple live and historical rooms to use the same name. Opaque room IDs remain authoritative for admission, links, history, reports, and realtime commands.

## Consequences

- Create and rename operations do not perform name availability checks or silently suffix user input.
- Discovery distinguishes rooms through their privacy/full/live state, category/tags, current presence/counts, and opaque link identity rather than promising unique names.
- Search may return multiple same-named Active Rooms as separate results under normal ranking.
