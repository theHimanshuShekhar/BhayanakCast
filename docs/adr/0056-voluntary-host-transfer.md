# ADR 0056: Let the Host transfer authority to a current member

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Deterministic Host handoff covers departure, but a current Host may need to delegate room settings and moderation without leaving the social room.

## Decision

After a focused confirmation names the selected current Room Member and explains the former Host will lose controls, the current Host may transfer Host authority. The server applies the transfer immediately, keeps both Accounts in the room, preserves all Streams and subscriptions, and broadcasts the new Host state.

The target must be an active member of the same live room at the time of transfer. V1 does not add a recipient request or acceptance workflow.

## Consequences

- The former Host becomes an ordinary Room Member and loses Host controls immediately.
- The new Host may transfer authority again or use existing Host controls.
- The transfer is a distinct server-authorized, auditable room-management event, not a client-side display change.
