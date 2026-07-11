# ADR 0064: Enter a newly created room immediately as Host

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Creating a room is the first-room activation action. Requiring a second Join step or an interstitial would add friction without adding a meaningful state.

## Decision

On successful Create Room, the server creates the room and creator's Room Membership, assigns the creator Host authority, and routes the creator directly into the room. V1 has no room-ready/lobby/interstitial state.

If the creator already belongs to a live room, creation follows the safe one-room switch rule: validate creation first, then close the prior membership and apply its lifecycle effects before entering the newly created room.

## Consequences

- A failed create leaves an existing current membership unchanged and creates no partially visible room.
- The new Host can immediately use normal room, chat-only compatibility, stream, and settings controls.
- The creator's initial presence begins a normal membership interval and counts toward the room's 10-member cap.
