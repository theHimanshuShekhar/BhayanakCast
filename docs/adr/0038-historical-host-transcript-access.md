# ADR 0038: Give every historical Host transcript access

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Rooms may hand Host ownership to another Account before they end. A retained Room Transcript needs a stable, auditable authorization rule after live membership disappears.

## Decision

Every Account that held Host ownership at any time during a room may read that room's retained transcript after it ends. Platform Admins retain their separate authorization.

## Consequences

- Host-ownership history is a persisted authorization fact, not only transient Socket.IO state.
- The final Host, original creator, and any intervening Host all qualify when they held the role.
- Transcript access remains subject to account deletion/anonymization and the 30-day retention window.
