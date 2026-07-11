# ADR 0069: Confirm room leave only for Hosts or active streamers

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Leaving is routine for ordinary members but has material effects when it ends local media or transfers room authority. Confirming every leave would make normal browsing and safe room switching unnecessarily slow.

## Decision

An ordinary non-streaming, non-Host Room Member leaves immediately. The UI requires a confirmation when leaving will stop the Account's active Stream or transfer its Host authority. If both apply, one confirmation explains both consequences.

The same safeguard applies to an otherwise successful room switch or new-room creation that closes the current membership.

## Consequences

- Cancellation preserves the current room membership and media state.
- A confirmed leave follows the normal authoritative Stream-stop and Host-handoff/empty-room lifecycle.
- Forced departures from kick, Room Ban, all-access sanction, connection displacement, and room end do not wait for a client confirmation.
