# ADR 0002: Retain the V1 peer-to-peer media boundary

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The preserved V1 contract uses direct WebRTC media with Socket.IO only for room coordination and signaling. This makes room capacity and browser support product-visible constraints.

## Decision

V1 retains direct peer-to-peer media: a hard 10-member room cap, explicit stream subscriptions, Chromium-family desktop browser support for stream creation, no shared voice, and no TURN relay fallback at launch.

## Consequences

- The product must present a compatibility warning and recoverable watch-connection failure state rather than silently relaying media.
- A future capacity or reliability expansion requires a new media-topology decision.
