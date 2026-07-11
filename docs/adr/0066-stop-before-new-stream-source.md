# ADR 0066: Require stopping before a new stream source

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Each Room Member has at most one active Stream. Replacing a capture track in place would add renegotiation, viewer, and failure behavior without improving the V1 interaction enough.

## Decision

To share a different screen or application, a streamer explicitly stops the current Stream and starts a new Stream through the browser picker. The former Stream ends for viewers before the new Stream is created.

Browser-initiated capture end follows the same normal Stream-stop path.

## Consequences

- V1 has no in-place source replacement or multi-source publication.
- Viewers may see the ordinary stopped state and then choose/recover the new Stream according to their current subscription behavior.
- The new Stream receives a new live session/identity and starts with no inherited preview or peer connections.
