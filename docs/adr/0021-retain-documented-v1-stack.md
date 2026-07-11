# ADR 0021: Retain the documented V1 implementation stack

- **Status:** Superseded by ADR 0105
- **Date:** 2026-07-10

## Context

The rewrite preserves the V1 functional contract and needs an explicit implementation boundary so architectural exploration does not expand into an unrequested platform migration.

## Decision

Retain the documented stack: TypeScript and React on TanStack Start; TanStack Query for Home domain fetching/cache and SSR hydration; Socket.IO for application realtime coordination; PeerJS with an in-app PeerServer and public STUN for WebRTC signaling; Better Auth with Discord sign-in/session ownership; Drizzle with PostgreSQL; Valkey for rate limiting; TanStack Pacer for the explicit client execution-control boundaries in ADR 0092; Node.js and pnpm; and the documented single-origin deployment boundary.

## Consequences

- The rewrite replaces code and design, not its framework/runtime/persistence/realtime foundations.
- PeerJS/PeerServer is an explicit media-signaling exception to the retained stack, selected to replace Socket.IO's prior WebRTC-signaling role.
- The retained stack still requires current-library documentation review when implementation begins.
