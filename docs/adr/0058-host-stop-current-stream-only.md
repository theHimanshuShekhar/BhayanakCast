# ADR 0058: Limit Host stream stop to the current Stream

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Hosts need to interrupt an active Stream when its content or behavior disrupts the room. A separate per-room stream restriction would overlap with Room Bans and Platform Sanctions.

## Decision

A Host may stop any current active Stream in their live room. The action immediately ends that Stream for every viewer. It does not prevent the former streamer from starting another Stream if normal admission and sanction rules allow.

V1 has no Host-written reason, temporary stream mute, or per-member stream restriction.

## Consequences

- Repeated or serious behavior escalates through the existing Room Ban or Platform Sanction paths.
- Stream-stop broadcasts use the same viewer state transition as a normal Stream end.
- The former streamer must explicitly start capture again; there is no automatic Stream recovery.
