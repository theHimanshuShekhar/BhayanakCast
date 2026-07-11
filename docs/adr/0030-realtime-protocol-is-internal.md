# ADR 0030: Treat the Socket.IO protocol as internal to the rewrite

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The public URL contract remains stable, but the documented Socket.IO event catalog is an implementation wire protocol rather than a third-party public API.

## Decision

The rewrite may redesign all Socket.IO event names, payloads, acknowledgements, and error-code mechanics. It must preserve the confirmed end-to-end product behavior, authorization, validation, recovery states, and user-visible error handling; no legacy protocol shim is required.

## Consequences

- The React client, Socket.IO application/signaling server, and native WebRTC connection state migrate together in a clean cutover.
- Tests assert behavioral contracts rather than the previous event strings unless a new protocol document establishes an intentional wire contract.
- The public HTTP route contract in ADR 0029 is unaffected.
