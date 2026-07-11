# ADR 0011: Keep full discovery public before sign-in

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

BhayanakCast is a public discovery platform. The rewrite must distinguish browsing public product information from actions that alter room state or expose admitted-room data.

## Decision

Unauthenticated visitors may browse live public and private room cards, Past Streams, search/filter results, and public-profile links. Private cards retain their lock state and live participant-identity protections. Joining, creating rooms, room chat, streaming, watching, moderation, and account deletion require Discord sign-in.

## Consequences

- Every anonymous discovery/profile read must use a server-enforced public projection.
- Private password admission never happens implicitly through a public card or route loader.
- Auth-required calls must return actionable sign-in states rather than leaking room internals.
