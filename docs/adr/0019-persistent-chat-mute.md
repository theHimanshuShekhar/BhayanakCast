# ADR 0019: Add persistent account-level chat mute

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

General-audience rooms need an individual safety control in addition to reporting and moderator enforcement, without changing other members' ability to participate in a shared room.

## Decision

An Account may locally mute another Account's chat across all rooms until manually unmuted. A mute hides only the target's chat messages for the muting Account. It does not affect room membership, streams, profiles, discovery, reports, or the target's own experience.

## Consequences

- The preference is private and must not emit a room event or notify the muted Account.
- The user needs an accessible unmute/manage-preferences path.
- Mute is not a substitute for a Report, Room Ban, or Platform Sanction.
