# ADR 0085: Show recent Past Streams as a compact two-column list

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home includes exactly ten recent Past Streams as quiet community continuity beneath live discovery. These records contain no replay media, so a thumbnail gallery would imply content that does not exist.

## Decision

Desktop shows the ten recent Past Streams in a compact two-column list; mobile collapses to one column. Each item shows the room name, ended time, public/private state, category/tags when present, participation/Stream summary, and an action to open the stable Past Stream summary.

Past Stream items use no preview image, fake thumbnail, carousel, pagination, or table treatment. They are visually quieter than Live Room cards and remain ordered by end time descending.

## Consequences

- The section can communicate recent community history without competing with the featured/live media mosaics.
- Long names and optional metadata must truncate/wrap without changing chronological order or hiding the open action.
- Empty history omits the list and uses concise supporting copy within the Live Rooms empty state rather than rendering an empty second panel.
