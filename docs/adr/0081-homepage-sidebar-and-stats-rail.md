# ADR 0081: Frame Home with identity and statistics rails

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home needs persistent product identity, fast room creation, visible community presence, and a compact global pulse without pushing the Live Rooms discovery column down.

## Decision

Desktop Home uses three structural regions:

1. A persistent 72px left icon rail with the `B` brand mark, Home, Create or the anonymous Discord door, Profile, and the theme toggle. Each control has an accessible name and a hover/focus tooltip. When signed in, activating the account control opens a popout with Profile and Log out actions.
2. The central search-first discovery column with search/filters, the featured Live Room and ranked room list, then ten recent Past Streams.
3. A right rail with a live count of distinct connected people and a presence icon, global statistics, and a compact Create Room launch panel with short clubhouse context. Its button opens the shared creation dialog for an Account; for an Anonymous visitor, the same `Create Room` action starts full-page Discord OAuth and returns to Home with a blank dialog.

The global statistics are Live Rooms, active Streams, current Room Memberships, rooms created today, and today's peak connected signed-in Accounts. “Today” uses one configured operator timezone for every viewer.

*Amended 2026-08-11 (issue #59).* This ADR originally placed the brand mark, presence count, Create Room, and the account avatar in a wide left identity sidebar. The shipped shell keeps one 72px icon rail at both desktop stages and moves presence and Create Room into the right rail, so the two live counts and the statistics read as one block instead of being split across opposite edges. Identity is still persistent and still keyboard reachable; only its side changed.

## Consequences

- Live rail/global values update without reordering the discovery column.
- The account popout contains only Profile and Log out in V1; it is keyboard operable, focus-managed, dismissible, and not clipped by the rail.
- The right rail never duplicates the room-creation fields; one shared dialog owns name, visibility/password, category, and tags.
- Anonymous visitors retain the brand mark and the Discord door in the icon rail and the presence/create affordances in the right rail, but have no account avatar menu; participation still passes through Discord sign-in.
- Mobile adaptation requires a separate composition decision rather than compressing both rails into the viewport.
