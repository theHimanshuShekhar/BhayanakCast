# ADR 0003: Keep private rooms publicly discoverable

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

BhayanakCast distinguishes a private room from an unlisted or invite-only room. Discovery supports the social purpose of the product, while admission and participant identity remain protected.

## Decision

A private room remains visible in public discovery with a clear lock state. It requires the room's shared password before admission and hides participant identities until admission.

## Consequences

- Discovery and pre-admission room DTOs must enforce the privacy projection server-side.
- A private room does not imply direct-link-only or invitation-only access.
- Password failure must leave the visitor outside the live room and allow a clear retry path.
