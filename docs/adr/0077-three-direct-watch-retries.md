# ADR 0077: Retry failed direct-watch connections three times

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

A member can pass the compatibility gate yet encounter a transient peer-connection failure when explicitly selecting a Stream. One immediate failure is too brittle, while indefinite retry hides the actual state and creates uncontrolled peer traffic.

## Decision

After the initial direct-watch connection attempt fails, automatically retry that same current Stream three times after 1, 2, and 4 seconds. Keep the member in the room and show bounded connecting/retry progress.

Implement each explicit selection or manual Retry as a fresh TanStack Pacer `AsyncRetryer`: `maxAttempts: 4`, `baseWait: 1000`, `maxWait: 4000`, and `jitter: 0`. Wire `getAbortSignal()` into the active native peer attempt. Stream end/change, another selection, leave, or manual cancellation calls `abort()`, closes the `RTCPeerConnection`, and discards the single-use retryer rather than resetting it for reuse.

If all three retries fail—or the Stream ends or changes during recovery—clear the subscription attempt and return the tile to its current Stream Preview/stopped state. Show a manual Retry action when the Stream still exists, plus compatibility/recovery guidance. Never begin another automatic retry cycle without a new explicit selection or manual Retry.

## Consequences

- Selecting another Stream or leaving cancels outstanding retry timers and peer attempts.
- A manual Retry starts one fresh initial attempt followed by the same bounded three-retry schedule.
- Retry telemetry may record timing/outcome but never media, room names, or peer/account identifiers outside the approved analytics boundary.
