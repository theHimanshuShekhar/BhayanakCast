# 1. P2P mesh for media

Date: 2026-09-27 · Status: accepted

## Context
Rooms carry screen shares, cameras and mics for up to ~15 people. An SFU (e.g. LiveKit) would carry all media through our server.

## Decision
Media flows peer-to-peer over a WebRTC full mesh. The server only does signalling, DB operations and server functions — it never relays or processes media.

## Consequences
- Near-zero server bandwidth/CPU for media; cheap to host.
- Each sender uploads one copy of every track per receiving peer, so client upload bandwidth is the scaling limit. Room caps, encoding settings and per-peer subscription must be designed around this.
- Features that assumed server-side media (egress snapshots, SFU webhooks for join/leave) must be done client-side or via signalling events.
- NAT traversal still needs STUN, and TURN for peers that can't connect directly (TURN relays media — decision pending).

## Addendum: connection model
- There is one `RTCPeerConnection` per peer pair (up to 9 per client). Mic, camera and screen tracks all go over that connection.
- Renegotiation (share start/stop, cam toggle) uses the WebRTC **perfect negotiation** pattern. Polite/impolite roles are decided by comparing user IDs.
- It is written directly against native browser WebRTC APIs, with no mesh library, so per-pair codec preference and bitrate/resolution control (ADR 2) stay fully in our hands.
