# ADR 0092: Use TanStack Pacer for client execution control

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

V1 has several browser-side timing contracts: delayed Home search, bounded direct-watch retries, and a latest-value Stream Preview upload cadence. Hand-written timers would duplicate cancellation, pending-state, teardown, retry, and trailing-call behavior. TanStack Pacer provides typed React and framework-agnostic utilities for these cases, but is currently beta and must not become an alternative source of truth for server policy.

## Decision

Add `@tanstack/react-pacer` and `@tanstack/pacer` to the retained application stack. Use Pacer only where an explicit execution-control contract exists:

- **Home search:** `useDebouncer` from `@tanstack/react-pacer`, trailing with `wait: 250`. Input calls `maybeExecute`; Enter calls `flush`; unmount keeps the default cancellation behavior. Subscribe only to `isPending` for localized progress. The debounced execution performs canonical URL navigation; TanStack Router/Start owns loader cancellation and stale-result protection.
- **Direct-watch recovery:** Create one `AsyncRetryer` from `@tanstack/pacer` per explicit cycle with `maxAttempts: 4`, `baseWait: 1000`, `maxWait: 4000`, and `jitter: 0`, yielding the initial attempt plus retries after 1, 2, and 4 seconds. Wire `getAbortSignal()` into the native WebRTC attempt. Stream end/change, another selection, leave, or manual cancellation calls `abort()`, closes the `RTCPeerConnection`, and discards the single-use retryer.
- **Stream Preview uploads:** `useAsyncThrottler` from `@tanstack/react-pacer` with `wait: 120000`, `leading: true`, and `trailing: true`. The first usable preview may upload immediately; calls inside the window collapse to the latest capture. Stop/leave/unmount calls both `cancel()` and `abort()` and passes `getAbortSignal()` to the actual upload.
- **Room typing presence:** `useThrottler` from `@tanstack/react-pacer` with `wait: 2000`, `leading: true`, and `trailing: true` bounds live typing refresh signals while preserving cancellation access. Empty input, blur, send, leave, or disconnect cancels pending trailing work and sends/derives stop; the server independently expires typing state after five seconds, so Pacer never becomes its authority.

Do not use Pacer as authoritative abuse protection, room expiry, reconnect grace, membership lifecycle, sanctions, or persisted job scheduling. Those remain server-side domain rules enforced by Valkey, Socket.IO/application state, and PostgreSQL as already documented. Do not add Pacer wrappers to one-shot actions merely to disable duplicate UI submission; mutation state is sufficient.

Because Pacer is beta, pin an exact reviewed version in the lockfile. Do not create local debounce/throttle/retry wrappers; import the narrow official API at each behavior boundary. A future incompatible upgrade requires focused tests for these four contracts.

## Consequences

- Cancellation and teardown behavior are explicit and shared with the chosen timing primitives rather than scattered timer bookkeeping.
- Pacer pending/executing state can drive accessible localized status without broad component subscriptions.
- Client pacing improves UX and network behavior but never weakens or replaces server validation and rate limits.
- The dependency has a known beta API risk, contained by exact versioning, narrow usage, and behavior tests.
