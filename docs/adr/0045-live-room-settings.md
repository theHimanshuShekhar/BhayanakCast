# ADR 0045: Permit Host metadata and visibility changes while live

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Hosts need to correct or adapt a room without ending an active social space. Privacy transitions must preserve admission safety and prevent a stale private password from surviving a public room.

## Decision

The current Host may change a live room's name, category, tags, and visibility.

- Switching Public to Private occurs through the settings save with a valid new private-room password. Existing admitted members remain; future and rejoining members must pass the new password gate.
- Switching Private to Public requires explicit confirmation because it clears the password hash immediately. Existing admitted members remain; future members use normal public admission gates.
- Discovery, profile, and realtime projections update to the room's current visibility immediately.

## Consequences

- Changing to Private must hide live participant identities from discovery without evicting admitted members.
- Changing to Public does not recover or retain the prior password.
- Room settings mutations require the same Host, room-state, sanction, and connection authorization as other live Host controls.
