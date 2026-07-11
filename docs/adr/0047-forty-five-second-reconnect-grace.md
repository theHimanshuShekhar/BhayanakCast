# ADR 0047: Reserve unexpected-disconnect membership for 45 seconds

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Transient browser and network failures should not immediately end a social-room session, while a 10-member capacity must not stay blocked indefinitely.

## Decision

On an unexpected disconnect, reserve the Room Member's membership and capacity for 45 seconds. If the same authenticated Account reconnects during that interval, automatically restore its room membership, presence, and chat state without repeating room admission.

An active Stream and remote Stream Subscription stop immediately on disconnect. Recovered members must explicitly begin sharing again and explicitly select Watch again even if the formerly watched Stream still exists; membership restoration never resumes peer media.

At grace expiry, process the departure through normal Host-handoff, empty-room, and Past Stream lifecycle rules.

## Consequences

- Intentional leave, kick, ban, account-connection replacement, room end, and admission loss do not receive the grace.
- Private-room password checks are not repeated for a valid grace reclaim.
- The UI must make reconnecting/recovered/stopped-stream state visible rather than implying uninterrupted media.
