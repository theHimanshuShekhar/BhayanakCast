# ADR 0057: Make Room Bans immediate and Host-cleared

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Hosts need a room-scoped way to remove an actively disruptive member and prevent immediate re-entry. Time limits and reason collection would add management and privacy complexity not needed for V1.

## Decision

After a confirmation names the target and explains the re-entry effect, a Host Room Ban immediately removes the target from the current room and stops any active Stream. The target receives generic access-denied messaging and cannot re-enter until a current Host manually clears the Room Ban or the room ends.

Hosts manage active Room Bans through a simple ban list. V1 does not require or display a Host-written ban reason, and has no timed Room Bans.

## Consequences

- A Room Ban is distinct from a kick: both force leave, but only a Room Ban blocks future admission.
- A Host transferred into the room inherits authority to clear its existing Room Bans.
- Room Bans end with their room; platform sanctions remain separate account-level enforcement records.
