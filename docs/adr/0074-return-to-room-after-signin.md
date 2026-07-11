# ADR 0074: Return signed-in visitors to room pre-admission

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

An anonymous visitor may initiate Join from a live-room view, but Discord OAuth is an external round trip. Automatically admitting afterward could unexpectedly consume membership or switch rooms, and private passwords must not be carried through authentication state.

## Decision

After Discord sign-in initiated from a room Join action, return the Account to that same room's pre-admission view. Join remains explicit and all current admission state is re-evaluated.

Preserve only the intended room identifier through authentication. Never persist or transport a private-room password through OAuth; the Account re-enters it before Join.

## Consequences

- Changed room state, capacity, sanctions, bans, and visibility are shown before the Account commits admission.
- Sign-in alone never creates Room Membership or media-signaling authority.
- Invalid/ended room intent falls back to the corresponding room summary/error with a route to discovery.
