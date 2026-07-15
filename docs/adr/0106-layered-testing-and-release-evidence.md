# ADR 0106: Use layered testing and separate release qualification

- **Status:** Accepted
- **Date:** 2026-07-12

## Context

BhayanakCast combines server-owned room and membership lifecycles, authenticated realtime commands, direct browser-to-browser WebRTC, durable PostgreSQL state, disposable Valkey policy state, responsive multi-user UI, and production-only network and operational boundaries. Browser-only testing would make lifecycle races slow and difficult to control, while unit and integration tests alone would not prove user-visible multi-user behavior, browser media negotiation, supported-client compatibility, capacity, or recovery operations.

The test architecture must preserve the authority boundaries defined elsewhere: production runtime schemas validate network input; server policy owns lifecycle and authorization; Better Auth owns sessions; PostgreSQL and Valkey retain their distinct failure semantics; Playwright does not substitute for real-device, real-network, load, backup, or restore evidence.

## Decision

Use five evidence layers.

### 1. Vitest unit, property, and model tests

Use Vitest for fast process-local tests of pure domain policy and state transitions. Cover normalization, user-visible character limits, validation, deterministic discovery ranking, role/capability calculation, room and membership transitions, Host succession, Stream rules, and the one-active-watch invariant.

Use targeted property-based tests for high-dimensional normalization, ranking, validation, and bounded-collection rules. Use model-generated command sequences for core room, membership, Host, Stream, and watch invariants. Keep named business scenarios as readable example tests; do not spread generators into UI and orchestration tests.

Require complete branch coverage for critical pure-domain policy and state-transition modules. Require meaningful changed-code coverage, and introduce a repository-wide floor only after implementation establishes an honest baseline. Coverage numbers never replace behavioral assertions.

### 2. Vitest production-shaped integration tests

Use Vitest to run the real custom Node HTTP listener with TanStack Start request handling, Better Auth, PostgreSQL, Valkey, and Socket.IO. Replace only uncontrollable external boundaries such as Discord OAuth responses. Better Auth session creation, PostgreSQL persistence, cookies, expiry, revocation, and application authorization remain real.

Give each stateful test worker an isolated PostgreSQL database or schema and a unique Valkey namespace. Reset state between scenarios. Transaction rollback is permitted for narrow repository tests, but is not the isolation mechanism for server tests spanning pooled connections, Socket.IO handlers, lifecycle callbacks, or multiple Accounts.

Inject one application clock and scheduler into lifecycle code. Production binds them to real time; tests advance them deterministically for reconnect grace, empty-room grace, room expiry, retention, and sanction expiry. Keep a small number of real-timer smoke tests for scheduler wiring. Do not shorten production durations only for tests.

Integration tests own the exhaustive transition and authorization matrices. They cover:

- target-first room switching, reconnect, revival, expiry, Host transfer, sanctions, moderation, Stream, watch, chat, deletion, and retention transitions;
- concurrent, duplicated, reordered, stale, and replayed commands;
- every server command across anonymous, authenticated, admitted Member, Host, historical Host, Platform Admin, sanctioned, deletion-pending, displaced, reconnecting, and stale-session states;
- canonical acknowledgements, persistence, broadcasts, signaling forwarding, and the absence of forbidden side effects;
- valid and malformed, oversized, stale, replayed, and unauthorized HTTP and Socket.IO payloads through the production runtime schemas;
- deterministic adapter failures plus selected real PostgreSQL, Valkey, signaling, and connection faults.

Tests assert behavioral outcomes rather than treating internal Socket.IO event names as a public compatibility contract.

### 3. Playwright browser end-to-end tests

Use Playwright for representative browser-observable journeys rather than the exhaustive server transition matrix. A multi-user scenario creates separate browser contexts within one test for Host, members, and Platform Admin so sessions remain isolated while actions and assertions are synchronized deterministically.

Keep Better Auth real and mock only Discord's external OAuth, token, and profile responses. Routine media scenarios use deterministic synthetic screen/audio input with real `RTCPeerConnection`, real Socket.IO signaling, and real media attachment.

Every pull request runs critical Chromium multi-user journeys and a focused Firefox/WebKit compatibility subset. Scheduled suites extend browser and recovery coverage. Playwright WebKit and device emulation are useful compatibility signals but do not satisfy the real iOS Safari or Android Chrome support commitment.

Playwright also owns:

- semantic role, accessible-name, state, and announcement assertions;
- automated accessibility rule scans on representative states;
- keyboard-only operation, focus trap/return, reduced-motion, drawer, sheet, dialog, room-control, and moderation contracts;
- selective screenshot baselines for stable Home, dialog, room mosaic, companion, and recovery states at small, medium, and wide layouts in both themes.

Automated accessibility checks supplement rather than replace periodic manual screen-reader and actual contrast review.

### 4. Capacity and network qualification

Do not use the functional Playwright suite as the primary load harness. Use a lightweight authenticated HTTP/Socket.IO actor harness for 25 simultaneous full rooms and 250 Accounts, covering chat, presence, acknowledgements, signaling, reconnect bursts, dependency pressure, tunnel restart, and event-loop delay. Use controlled browser/WebRTC runs for actual peer connections and synthetic media, including targeted full-topology runs. Record enough load-generator and server metrics to distinguish application limits from generator exhaustion.

Use a separate real-device and real-network ICE matrix for the supported desktop browsers, current and previous iOS Safari, and current and previous Chrome on Android. This matrix—not local Playwright negotiation—provides evidence for the documented direct-watch reliability criterion.

### 5. Operational release qualification

Before release, retain machine-verifiable evidence for the production-shaped single listener, static assets and SSR, Better Auth callback, Socket.IO upgrade, Cloudflare public-origin/proxy behavior, real Discord configuration, documented dependency failures, encrypted PostgreSQL backup and successful restore, capacity target, and supported real-device/network matrix. Run useful subsets on schedules between releases; these qualifications do not block every pull request.

## Test data and reliability

Use typed builders for irrelevant preconditions and exercise the behavior under test through its public HTTP, Socket.IO, or browser boundary. Avoid opaque global database seed snapshots and avoid forcing all setup through slow UI flows.

Tests wait for observable state or advance the controlled clock; arbitrary sleeps are prohibited. Print deterministic seeds and scenario identifiers on failure. A CI retry may collect Playwright trace, video, browser console, server logs, and relevant acknowledgements, but a test that passes only on retry remains flaky and does not silently become green. Any quarantine requires an owner and expiry.

## Pull-request and scheduled gates

Every pull request runs all Vitest unit/property/model tests, all production-shaped Vitest integration tests, critical Chromium multi-user Playwright journeys, the focused Firefox/WebKit subset, and risk-based coverage gates.

Nightly or scheduled runs extend Playwright recovery/browser coverage, race/model seeds, selected real-service failure drills, and flake detection. Release qualification adds load, real-device/network ICE, tunnel/public-origin, real Discord, dependency-recovery, and backup/restore evidence.

## Explicit telemetry exception

Telemetry payload privacy is reviewed manually rather than enforced by automated allowlisted log/PostHog schemas. This is an accepted regression risk: the automated suite does not prove that newly added or nested fields exclude every prohibited identity or content value. Manual review remains responsible for the telemetry restrictions in the product contract.

## Consequences

- Most lifecycle permutations fail quickly and deterministically below the browser layer, while Playwright proves representative multi-user outcomes that users can observe.
- Real PostgreSQL, Valkey, Better Auth, Node, and Socket.IO integration costs more than in-memory mocks but verifies the repository's actual authority and failure boundaries.
- Worker-isolated durable and policy state permits safe parallel execution without relying on cross-connection transaction rollback.
- Synthetic local WebRTC keeps routine tests deterministic without being misrepresented as mobile, NAT, or launch-reliability evidence.
- Load, device/network, backup, restore, and public-origin evidence remain separate release qualifications rather than being hidden under an overloaded end-to-end label.
