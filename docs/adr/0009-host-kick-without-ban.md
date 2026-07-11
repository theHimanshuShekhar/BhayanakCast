# ADR 0009: Add a Host kick action without a room ban

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The inherited V1 Host could stop a stream or apply a Room Ban, but had no way to remove a disruptive member without permanently blocking re-entry for that live room.

## Decision

A Host may kick a Room Member. Kicking immediately removes the member and stops any active stream, but creates no Room Ban. The kicked Account may rejoin immediately when normal authentication, password, capacity, and sanction gates allow it. The removed member receives a generic system message; Hosts cannot attach a kick reason.

## Consequences

- Kick and Room Ban are distinct moderation actions with distinct user copy and audit records.
- Kicking closes the member's current membership interval and emits the same live-presence/stream-stop changes required for an ordinary forced leave.
- A Host still cannot delete messages, apply timeouts, or use chat slow mode in V1.
