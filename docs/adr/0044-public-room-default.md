# ADR 0044: Default new rooms to public visibility

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

BhayanakCast is a public community clubhouse. The Create Room flow must pick an initial visibility while preserving an explicit private-room password gate.

## Decision

Create Room defaults to Public visibility. An Account may switch to Private, at which point a password of at least eight characters is required before creation.

## Consequences

- The default supports discovery and first-room activation.
- The UI must make the current visibility and private-room implications clear before submission.
- The default does not remove server-side validation for private passwords or privacy projections.
