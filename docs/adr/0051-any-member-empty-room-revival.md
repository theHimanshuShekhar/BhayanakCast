# ADR 0051: Allow any eligible Account to revive an empty-grace room

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

After the last Room Member leaves, V1 retains the live room for five minutes before its Past Stream transition. The grace must specify whether the room is a private recovery hold or an active social space.

## Decision

During the five-minute empty-room grace, keep the room discoverable and joinable under its current public/private admission gates. The first eligible Account to join revives the room and becomes its Host.

If no one joins before grace expires, the room follows the normal Past Stream transition.

## Consequences

- A private room remains password-gated throughout empty grace.
- Host authority is not reserved for a departed former Host after the room becomes empty.
- Rejoining starts a new current membership interval; it does not recreate a stopped Stream or historical live state.
