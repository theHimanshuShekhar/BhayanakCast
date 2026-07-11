# ADR 0043: Combine Past Streams with a create-room empty state

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The rewrite launches with a fresh database, so a new signed-in Account may find no active rooms. The community-clubhouse experience must make the next action clear without a multi-step onboarding product.

## Decision

When no Active Rooms exist, show any available Past Streams/community history alongside a friendly empty discovery state with a prominent Create Room action. Do not add a separate guided onboarding flow.

## Consequences

- A fresh installation with no Past Streams still gives the first Account a clear way to start the community.
- The empty state must explain public/private room creation enough to prevent accidental privacy confusion.
- This state belongs to the redesigned discovery surface, not a separate public route.
