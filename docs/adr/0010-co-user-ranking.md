# ADR 0010: Rank top co-users by concurrent room membership time

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Public profiles expose top co-users, but the prior aggregate design did not specify what relationship produces that ranking.

## Decision

A pair of Accounts is ranked by total time concurrently admitted to the same room. Streaming, watching, and chat activity do not change the calculation; co-presence as Room Members is the relationship.

## Consequences

- Aggregation derives overlap from room-membership intervals rather than media or chat telemetry.
- Private-room participation contributes under the public-history decision in ADR 0007.
- The profile may display room count as supplemental context, but it must not replace concurrent time as the ranking measure.
