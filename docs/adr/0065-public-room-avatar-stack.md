# ADR 0065: Show public-room avatar stacks and member counts

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Discovery needs visible social presence without turning room cards into a public member directory. Private rooms already conceal live participant identities.

## Decision

A public live-room card shows a compact stack of current member avatars and the total member count. It does not show member names on the card. Private-room cards show neither participant avatars nor names, while retaining their total capacity/status information.

## Consequences

- Card presence is a current live projection and updates with room membership changes.
- Full member identity remains available only through the normal opened/joined-room experience and public profiles, subject to their existing access rules.
- Public cards must gracefully render an empty/no-avatar state during empty-room grace.
