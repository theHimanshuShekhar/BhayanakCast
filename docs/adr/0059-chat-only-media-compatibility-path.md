# ADR 0059: Admit compatibility-failed members as chat-only

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Direct peer-to-peer media may not work on a browser or restrictive network. Blocking the entire room would unnecessarily remove chat and social presence while V1 intentionally has no TURN relay fallback.

## Decision

A signed-in Account that fails the direct-media compatibility gate may join a room normally for presence and chat. The UI clearly marks direct media unavailable and offers retry/recovery guidance. The Account cannot start or watch direct media until compatibility succeeds.

Compatibility status may change while the Account remains a member; a successful retry enables ordinary stream/watch actions without a room rejoin.

## Consequences

- Chat-only members count toward the normal 10-member room capacity.
- Stream Previews remain ordinary non-media room state; no peer media session is created for a chat-only member.
- This is not a TURN, relay, transcode, recording, or alternate-media fallback.
