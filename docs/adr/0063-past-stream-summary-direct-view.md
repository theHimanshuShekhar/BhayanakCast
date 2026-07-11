# ADR 0063: Keep ended room URLs as Past Stream summaries

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Room URLs remain stable after the live room ends, but Past Streams are non-replayable historical records rather than active rooms or a public transcript archive.

## Decision

An ended room URL renders a Past Stream summary with its non-replayable end state and retained public metadata, plus a route back to live discovery. It has no Join control, media, Stream Preview, public transcript, or related-room recommendation surface.

The view remains noindex and Past Streams remain absent from in-app search.

## Consequences

- Stable room links retain useful context without implying that a room can be rejoined or replayed.
- Historical Host and Platform Admin transcript access remains separately authorized; it is not made public through this view.
- The bounded home Past Streams section and public-profile history can link to this same stable summary URL.
