# ADR 0081: Frame Home with identity and statistics rails

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home needs persistent product identity, fast room creation, visible community presence, and a compact global pulse without pushing the Live Rooms discovery column down.

## Decision

Desktop Home uses three structural regions:

1. A persistent left sidebar with a large `B` brand mark, a live count of distinct connected signed-in Accounts with a presence icon, a prominent Create Room button, and—when signed in—the current Account avatar anchored at the bottom. Activating the avatar opens a popout with Profile and Log out actions.
2. The central search-first discovery column with search/filters, the featured Live Room and ranked room list, then ten recent Past Streams.
3. A right rail with global statistics plus an authentication-dependent action section: signed-in Accounts see a compact Create Room launch panel with short clubhouse context and one button that opens the full creation dialog; anonymous visitors see Discord Log in.

The global statistics are Live Rooms, active Streams, current Room Memberships, rooms created today, and today's peak connected signed-in Accounts. “Today” uses one configured operator timezone for every viewer.

## Consequences

- Live sidebar/global values update without reordering the discovery column.
- The sidebar user popout contains only Profile and Log out in V1; it is keyboard operable, focus-managed, dismissible, and not clipped by the rail.
- The right rail never duplicates the room-creation fields; one shared dialog owns name, visibility/password, category, and tags.
- Anonymous visitors retain the left brand/presence/create affordances but have no account avatar menu; participation still passes through Discord sign-in.
- Mobile adaptation requires a separate composition decision rather than compressing both rails into the viewport.
