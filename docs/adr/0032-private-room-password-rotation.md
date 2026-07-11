# ADR 0032: Allow private-room password rotation without evicting members

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Private rooms are publicly listed but password-gated. Hosts need a way to change a shared password after it has been distributed without disrupting an active social room.

## Decision

A Host may rotate a live private room's shared password at any time, but cannot retrieve an existing password after it is saved. Every created or rotated private-room password must be at least eight characters. Existing admitted members remain in the room; future and rejoining members must pass the new password gate.

## Consequences

- The password is stored only as a replacement hash; no prior password is recoverable or retained for admission.
- Rotation is a Host-only room settings action and must not expose the new password in logs, analytics, or broadcasts.
- Password rotation does not bypass Room Ban, capacity, sanction, or the account-wide active-WebSocket policy.
