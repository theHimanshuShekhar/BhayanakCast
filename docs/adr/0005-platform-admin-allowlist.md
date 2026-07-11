# ADR 0005: Keep platform administration in a static allowlist

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Open Discord-authenticated participation requires a trusted platform-level safety authority. V1 needs a small, explicit operating model rather than a second role-management product.

## Decision

Platform Admin authority is granted only through a static deployment configuration allowlist of Discord account IDs. Changing Platform Admin membership requires a configuration/deployment change.

## Consequences

- No in-product role-management workflow or Discord guild-role synchronization is required for V1.
- Platform Admin actions must remain separately authorized and auditable from Host actions.
- Configuration validation must reject malformed allowlist input without exposing it to browser clients.
