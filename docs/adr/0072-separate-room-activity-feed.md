# ADR 0072: Keep room events in a separate Activity feed

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Membership, media, Host, and room-settings changes need visible confirmation, but inserting them into chat would mix server state with human-authored conversation and retained transcript content.

## Decision

V1 presents canonical room events in a separate live Activity feed. Chat contains only member-authored messages. Activity includes join/leave/reconnect, Host changes, Stream start/stop, and room metadata/visibility changes, plus generic forced-departure and moderation outcomes when members need to understand current state.

Activity never exposes private passwords, Host-written moderation text, sanction details, report data, or hidden private-room participant identities outside the admitted room.

Activity begins empty for each newly admitted member and shows only events received after that admission. V1 does not load, paginate, or retain prior Activity events.

## Consequences

- Chat retention and the Room Transcript do not include Activity-feed events.
- Activity is live-only and disappears when membership or the room ends.
- State-changing controls still update their primary room surfaces; Activity is a readable audit trail, not the source of authority.
- Generic moderation copy preserves room comprehension without disclosing internal enforcement details.
