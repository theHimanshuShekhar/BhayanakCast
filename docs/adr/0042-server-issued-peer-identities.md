# ADR 0042: Use server-issued opaque PeerJS session identities

- **Status:** Superseded by ADR 0104
- **Date:** 2026-07-10

## Context

PeerJS requires peer identifiers for signaling. Stable account-derived or browser-generated identifiers would weaken the relationship between media signaling, authenticated admission, and the account-wide connection replacement rule.

## Decision

After authenticated connection and room admission, the application issues an opaque PeerJS session identity bound to the current Account, active WebSocket connection, and admitted room. The identity expires when that connection is displaced, the Account leaves, the room ends, or admission otherwise ends.

## Consequences

- Peer identities must never encode or expose Discord IDs, Account IDs, room IDs, or other meaningful user data.
- PeerServer/media authorization can require a current app-issued identity for the requested room and active Stream.
- Global WebSocket replacement invalidates prior peer identities and tears down associated media without a client takeover handshake.
