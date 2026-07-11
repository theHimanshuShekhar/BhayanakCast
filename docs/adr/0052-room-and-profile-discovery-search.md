# ADR 0052: Search active rooms and public profiles

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The activity-ranked discovery feed supports ambient browsing, but users also need to find a known room topic and a person in the public community.

## Decision

V1 in-app discovery searches Active Room names, categories, and tags plus public-profile identity. Category/tag filters apply to room results only. Active Room and public-profile results are visibly separated.

Search never indexes or returns Past Streams, chat, reports, media, private transcripts, sanctions, private preferences, or live hidden participant identities.

## Consequences

- Search projections must apply the same public/private visibility rules as the corresponding current-room and public-profile surfaces.
- Private-room cards may remain searchable only to the extent their already-public discovery metadata allows; participant identities remain hidden while live.
- Search implementation is a product discovery feature, separate from crawler indexing and robots directives.
