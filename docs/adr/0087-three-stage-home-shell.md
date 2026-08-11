# ADR 0087: Use a three-stage responsive Home shell

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

The wide Home composition has two useful rails, but retaining both through tablet widths would squeeze the discovery column. Switching directly from three columns to a phone shell would also discard useful persistent navigation too early.

## Decision

Home uses three responsive stages:

1. **Wide, 1280px and above:** persistent left icon rail, fluid center discovery column, and right identity/statistics/action rail.
2. **Medium, 768–1279px:** retain the same icon rail, remove the right rail, and place global statistics in the same collapsed disclosure used by the search utility area.
3. **Small, below 768px:** remove both rails and use the compact top brand bar plus persistent bottom navigation. Global statistics remain collapsed with search utilities.

Breakpoints describe composition changes rather than device names. The center keeps search, Live Rooms, and Past Streams in the same order at every stage.

*Amended 2026-08-11 (issue #59).* Stages 1 and 2 originally described a wider left identity sidebar at wide widths. Both desktop stages ship one 72px icon rail; identity — the connected-people count, statistics, and the Create Room panel — lives in the right rail. See ADR 0096 for the measured frame.

## Consequences

- Create Room and account access remain persistent at medium widths without compromising the discovery column.
- The top bar and bottom navigation are small-stage components, not merely visually hidden copies of desktop rails.
- Safe-area padding, visible focus, and adequate touch targets apply to the fixed small-stage bars.
