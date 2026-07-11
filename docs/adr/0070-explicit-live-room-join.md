# ADR 0070: Require an explicit Join action for live rooms

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Opening a live-room URL should not silently consume the Account's sole Room Membership, a room capacity slot, or trigger departure effects in another room.

## Decision

A signed-in non-member first sees a pre-admission room view with public metadata, privacy/capacity state, and an explicit Join action. Public rooms admit after Join succeeds; private rooms collect and validate the password as part of that Join flow.

Membership, room chat, authorized media signaling, compatibility-gated media controls, and live participant details begin only after successful admission.

## Consequences

- Merely opening a room URL never leaves the Account's current room.
- Full, banned, sanctioned, ended, and invalid-password outcomes remain pre-admission states.
- Discovery cards and direct URLs use the same explicit admission convention.
