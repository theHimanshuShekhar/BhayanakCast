# ADR 0104: Use native WebRTC signaling over authenticated Socket.IO

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

V1 already requires authenticated Socket.IO coordination for room admission, membership, Stream availability, moderation, and lifecycle events. PeerJS would add a second client realtime abstraction and an in-process PeerServer with a separate WebSocket upgrade path. Stock PeerServer does not enforce BhayanakCast room admission; retaining it would require custom upgrade authentication, opaque peer capabilities, revocation, and additional deployment routing solely to avoid a small browser negotiation state machine.

## Decision

Use browser-native `RTCPeerConnection` for direct peer-to-peer media. Exchange WebRTC offers, answers, and ICE candidates through the existing Socket.IO connection only. Socket.IO never transports captured audio or video.

Every client-initiated signaling command is acknowledged and authorized against the sender's current authenticated Account connection, admitted Room Membership, current Stream session, and one active remote Stream Subscription. Payloads identify opaque application Stream/session records, not user-generated peer IDs. Displacement, leave, admission loss, Stream stop, Room end, sanction, or explicit watch cancellation stops forwarding signaling and causes conforming clients to close the affected `RTCPeerConnection` immediately.

Use public STUN for ICE discovery and no TURN relay at launch. Model one `RTCPeerConnection` per directed Stream Subscription: at most one inbound watched Stream per member and at most nine outbound subscriber connections for that member's own Stream in a full 10-member room. A full room therefore has at most ten active directed subscriptions; a client publishing to nine viewers while watching one Stream has at most ten active peer connections.

## Consequences

- Remove `peerjs`, `peer`, PeerServer hosting, peer-identity issuance, and the second WebSocket route from the retained stack.
- One authenticated Socket.IO boundary owns application realtime and WebRTC signaling authorization; direct media remains outside the server.
- The client must implement explicit offer/answer/ICE buffering, connection teardown, and the already documented bounded retry states with native WebRTC APIs.
- Server revocation prevents new signaling and asks conforming clients to close media, but cannot cryptographically retract media already delivered to a browser. This is an inherent direct-P2P boundary.
- Direct connectivity remains best effort without TURN; compatibility and launch load tests remain required.
