# ADR 0014: Support mobile watching and chat

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

V1 stream creation remains limited to Chromium-family desktop browsers, but the product's social-room value should be available to mobile participants as viewers and chat participants.

## Decision

The compatibility-supported watch population includes the inherited major desktop browsers plus current and previous major iOS Safari and Chrome on Android. Mobile Accounts may explicitly watch one remote Stream at a time and use room chat but do not create Streams. The room bar keeps a disabled `Desktop only` Stream control with an explanation rather than exposing a failing capture action.

## Consequences

- The 99% direct-P2P watch criterion in ADR 0013 applies to this expanded supported population after the compatibility gate passes.
- Responsive room, watch-control, chat, and recovery states are launch requirements on the supported mobile clients.
- Other mobile browsers are best-effort and do not define the V1 support commitment.
