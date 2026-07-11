# ADR 0082: Adapt Home to a top brand bar and bottom navigation

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Desktop Home's identity and statistics rails cannot be compressed beside the discovery column on a phone. Mobile must preserve product identity, presence, creation, account access, and the search-to-room content order without stacking both rails above discovery.

## Decision

Mobile Home replaces the desktop rails with:

- a compact top brand bar containing the large `B`, live connected-Account count, and signed-in avatar or anonymous Log in affordance;
- persistent bottom navigation for Home, Create, and Profile/account access, with Admin visible only when authorized;
- a collapsed global-statistics disclosure inside the search utility area, before Live Rooms.

The main scroll order remains search/filters and the optional stats disclosure, Live Rooms including the featured room, then ten recent Past Streams. Create opens the same full dialog used on desktop.

## Consequences

- Mobile does not add a duplicate navigation drawer or stack desktop rail panels above content.
- The avatar/account affordance and bottom navigation must respect safe areas, visible focus, keyboard behavior, and adequate touch targets.
- The stats disclosure remembers no cross-session expanded preference in V1.
