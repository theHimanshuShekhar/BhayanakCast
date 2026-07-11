# ADR 0094: Render Active Room search as compact horizontal results

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Normal Home uses an editorial room grid driven by social rank, but search must emphasize text relevance and fast comparison without discarding the live-content signal.

## Decision

The Active Rooms search group is a one-column list of compact horizontal result cards. Each result keeps a small one-to-four-tile Stream Preview mosaic, room name, visibility/Full/live state, category/tags, member and active Stream counts, and allowed presence treatment. The entire result remains one accessible link to pre-admission; descriptive metadata is not independently interactive.

Direct matches precede fuzzy matches according to ADR 0090. Within equal relevance, rooms use normal social rank: member count descending, active Stream count descending, then meaningful activity descending. The separate Public Profiles group uses the same direct-before-fuzzy relevance tiers, then normalized Discord display name ascending and opaque Account ID as the deterministic final tie-breaker. Profiles are never ranked by popularity or usage.

Small widths stack each room result's mosaic above metadata only when a horizontal layout cannot retain readable text and touch targets. Search results never regain featured sizing or the editorial mixed grid.

## Consequences

- Search ranking is visible as a scannable list while current room media remains legible.
- Room ties preserve the same social priorities as unfiltered discovery.
- Profile ordering avoids creating a public popularity leaderboard.
- The result DOM follows displayed order and every card retains one focus target.
