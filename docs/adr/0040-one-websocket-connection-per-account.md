# ADR 0040: Keep one active WebSocket connection per Account

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The prior V1 policy scoped duplicate-client takeover to one room. The rewrite requires a stricter account-wide connection rule.

## Decision

When the server accepts a new authenticated WebSocket connection for an Account, it immediately disconnects every existing WebSocket connection for that Account across every page and room. The new connection becomes the Account's sole active connection. There is no duplicate-client confirmation or room-scoped takeover flow.

## Consequences

- A displaced client must clear local room state, stop any local stream/subscription, and show an account-connection-replaced state rather than automatically reconnecting and displacing the new connection.
- Displacing a connection that owns an active Stream stops that Stream; affected viewers return to the documented stopped/preview state.
- Opening another app tab/device may interrupt the Account's existing room session even if the new connection is not joining that room.
- The Socket.IO protocol remains internal; it can use any explicit displacement event/disconnect mechanism that preserves this behavior.
