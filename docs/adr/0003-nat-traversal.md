# 3. NAT traversal: STUN plus pluggable TURN, Cloudflare free tier from day one

Date: 2026-09-27 · Status: accepted

## Context
Some peer pairs behind CGNAT or strict/mobile NATs cannot connect directly (ADR 1). TURN fixes this by relaying their media, which costs relay bandwidth.

## Decision
- ICE servers are configuration, not code: a server function returns the ICE server list (STUN plus zero or more TURN providers) with short-lived credentials. Adding self-hosted coturn or another hosted TURN later means changing config only.
- STUN is always on.
- **Cloudflare Realtime TURN** is enabled from the start. Its free tier is 1,000 GB/month of egress, then $0.05/GB. Credentials are minted per session by a server function using the Cloudflare TURN key, so the key never reaches clients.
- Metered Open Relay (20 GB/month free) is a possible secondary provider. It is not enabled by default.

## Consequences
- Relayed pairs send their media through Cloudflare; this is the only case where media leaves peer-to-peer.
- Relayed bandwidth needs monitoring against the 1 TB/month free tier (admin dashboard candidate).
- A pair that fails even with TURN shows a per-peer "can't connect" state instead of silently missing tiles.

## Addendum: double NAT / CGNAT is best-effort for now
- Some users are expected to be behind double NAT or CGNAT. For now traversal is **best-effort**: gather all ICE candidates (host, server-reflexive via STUN, and relay via Cloudflare TURN), use ICE restart on connection failure, and try TURN over UDP, TCP and TLS on port 443 before giving up.
- A pair that still fails shows the per-peer "can't connect" state, and its ICE failure details are logged so we can see how often it happens.
- Dedicated handling (self-hosted coturn, IPv6-first candidates, relaying through a well-connected peer) is deferred until the logs show it is needed.
