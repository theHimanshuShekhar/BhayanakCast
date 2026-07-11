# ADR 0046: Keep full rooms visible without a waitlist

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Rooms have a hard V1 capacity of 10 Room Members. A queue would add ordering, notification, reconnect, and abuse semantics without improving the core watch-together model.

## Decision

Keep a full room visible in discovery with an explicit Full state. Disable admission until a member leaves. V1 has no waitlist, reservation, notification, or Host approval queue.

## Consequences

- Capacity is checked authoritatively at admission; the UI state is advisory and may become stale.
- A full private room still requires its password before any later admission attempt, once capacity is available.
- The empty/full presentation must provide a clear alternative route to creating or browsing another room.
