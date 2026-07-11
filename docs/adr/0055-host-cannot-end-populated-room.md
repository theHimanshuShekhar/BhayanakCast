# ADR 0055: Do not give Hosts a room-end control

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

A populated room can continue safely after its Host leaves through deterministic Host handoff. An immediate Host room-end action would let one member disrupt every other member without adding a necessary moderation capability.

## Decision

V1 does not provide a Host room-end action. A Host may leave normally; remaining members receive Host handoff according to the documented lifecycle. Only the existing Platform Admin live-room intervention may end a populated room early.

## Consequences

- Hosts retain stream-stop, Room Ban, ban-clear, kick, and room-settings controls, but not a collective termination power.
- A room still becomes a Past Stream through the normal empty-room-grace transition.
- UI controls must distinguish leaving a room from the Platform Admin-only end-room intervention.
