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

## Addendum: signalling survives a socket reconnect (2026-10-02)
- A page's offer or answer sent while its own realtime socket was reconnecting used to be dropped for good, leaving the peer on a placeholder or a frozen share until the next track change. The Mesh now learns from `send` whether a step went out, keeps the description that didn't (the latest offer, and the answer to the peer's offer), and sends them again when the page is back in the room: on the room's `room.snapshot` after the reconnect, which confirms the re-join (a refused one, a full room, sends nothing). Steps sent after the client's `room.join` are relayed even before the snapshot, as the server handles a socket's messages in order.
- Negotiation rules are unchanged. A kept offer goes again only while it is still the pending local offer (a peer's offer that rolled it back makes it stale), and each kept description goes as it stands then, with the candidates gathered since. A kept answer goes before any offer that followed it, so the peer sees them in the order they were made. Candidates and `visibility` steps are not kept: a description carries the candidates, and the pair's state is told again whenever it connects.
- Not covered: a step the server drops because its *recipient* is reconnecting (the Mesh's `hello` recovery covers a first offer), a `hello` dropped the same way, and a socket that dies after accepting a step.
- Each peer's quality pass now has a guard of its own, so one stats read that never returns skips only that peer instead of stalling quality adaptation for everyone.
