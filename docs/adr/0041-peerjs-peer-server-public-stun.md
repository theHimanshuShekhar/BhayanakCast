# ADR 0041: Use PeerJS with an in-app PeerServer and public STUN

- **Status:** Superseded by ADR 0104
- **Date:** 2026-07-10

## Context

V1 keeps direct peer-to-peer media without TURN relay. PeerJS provides the browser peer abstraction but requires a PeerServer for session metadata/candidate signaling and separately configured ICE servers for direct connectivity.

## Decision

Use PeerJS for browser media connections. Run PeerServer alongside the Node/TanStack Start application on the same public origin/port when the deployment is implemented. Configure PeerJS with a public STUN service for ICE candidate discovery; do not configure TURN relay.

Socket.IO continues to own application realtime state—room admission, membership, chat, discovery, moderation, and stream availability—but no longer carries WebRTC offers, answers, or ICE candidates.

## Consequences

- PeerServer carries signaling metadata only; audio/video remains direct WebRTC media between peers.
- The application must keep peer identity and signaling authorization constrained to admitted Room Members and active Streams; PeerServer integration cannot weaken room/safety gates.
- PeerServer and public STUN availability participate in the direct-watch reliability target and compatibility/recovery behavior.
- PeerJS/PeerServer replace Socket.IO's previous WebRTC-signaling role, while the rest of the Socket.IO stack remains retained.
