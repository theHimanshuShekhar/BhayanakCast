# ADR 0048: Hand host authority to the earliest remaining member

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

A live room can outlast its current Host. V1 needs a deterministic transfer rule that does not add an election workflow or unnecessarily end the social space.

## Decision

When the current Host permanently leaves—immediately for an intentional leave, kick, ban, displacement, or admission loss; after reconnect-grace expiry for an unexpected disconnect—the server assigns Host authority to the longest continuously present remaining Room Member.

If no Room Members remain, normal five-minute empty-room grace applies.

## Consequences

- Join/presence ordering must be server-authoritative and durable through reconnect grace.
- The transfer broadcasts current Host state before the new Host may perform Host controls.
- No vote, acceptance, or preference mechanism exists in V1.
