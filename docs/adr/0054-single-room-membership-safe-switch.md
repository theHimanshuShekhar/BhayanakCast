# ADR 0054: Allow one live room membership with safe switching

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

An Account's room presence, Stream, Host authority, and active remote subscription are all room-scoped. Concurrent membership would multiply state and network behavior. Leaving the current room before a target is known to admit the Account would create avoidable disruption.

## Decision

An Account may be a Room Member in exactly one live room at a time.

When joining another room, the server validates target-room admission—including access sanction, capacity, room state, Room Ban, and private password—before closing the current membership. If target admission fails, the Account remains in its current room unchanged. On success, the server closes the prior membership, stops any local Stream/subscription, performs required Host/empty-room lifecycle effects, and admits the Account to the target room.

## Consequences

- A browser cannot hold background presence, chat, or media in another room.
- A successful room switch can cause Host handoff or empty-room grace in the prior room.
- The client receives a single authoritative outcome, rather than attempting a transient dual-room join.
