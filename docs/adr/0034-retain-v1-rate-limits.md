# ADR 0034: Retain the documented V1 abuse-rate limits

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Any Discord-authenticated Account may participate, and Platform Admin moderation is best effort. Core abuse surfaces need deterministic, product-visible limits.

## Decision

Retain the documented V1 limits:

- room creation: 5 per hour per Account;
- chat: 30 messages per minute per Account per room;
- reports: 10 per hour per Account;
- stream start/stop: 10 commands per minute per Account per room;
- stream thumbnails: one upload every 110 seconds per stream session, capped at 100 KB; and
- private-room password attempts: 10 per 10 minutes per Account + room + IP.

WebRTC signaling and ICE relay are not blanket-rate-limited in a way that breaks connection setup.

## Consequences

- Rate-limit rejection is a visible, recoverable user state rather than a silent drop or socket failure.
- Valkey remains a required V1 dependency for this policy.
- Changes to these values require a policy decision and focused abuse/behavior tests.
