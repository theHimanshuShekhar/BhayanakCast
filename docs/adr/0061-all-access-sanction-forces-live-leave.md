# ADR 0061: Apply all-access sanctions to live rooms immediately

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

An all-access Platform Sanction must be meaningful for an Account that is already present in a live room, including one currently holding Host authority or streaming.

## Decision

Applying an all-access Platform Sanction immediately forces the Account out of every active room/session and stops every active Stream. Each affected room then runs ordinary departure behavior, including Host handoff or empty-room grace as applicable.

## Consequences

- The sanctioned Account cannot retain Host authority, room presence, or media after the sanction takes effect.
- Current room members receive the ordinary authoritative presence/stream/Host changes, without exposing unnecessary administrative detail.
- This enforcement is distinct from ordinary chat, stream, or room-creation sanctions, which have narrower action scopes.
