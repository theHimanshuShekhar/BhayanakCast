# ADR 0020: Order active-room discovery by social presence

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The public community clubhouse needs a default discovery order that helps visitors find socially active rooms without personalizing the ranking.

## Decision

Active Rooms are ordered by current Room Member count descending, then active Stream count descending. Remaining ties use the room's most recent meaningful activity.

## Consequences

- Public and private rooms use the same ordering while preserving their respective public projections.
- Discovery summaries must maintain canonical member, stream, and activity values; UI sorting cannot rely on placeholder counts.
- Personalized recommendations are not required for V1.
