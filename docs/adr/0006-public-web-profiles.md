# ADR 0006: Expose public profiles on the web

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The prior route contract restricted profile browsing to authenticated accounts even though the product calls them public profiles. The rewrite needs an unambiguous visibility boundary.

## Decision

Anonymous visitors may open public profile URLs. The public projection contains Discord-mirrored identity, aggregate usage statistics, public and private Past Stream history, and top co-users. It never exposes administrative data, private transcripts, reports, sanctions, or live hidden participant data.

Active Accounts have no per-profile or per-field privacy control. Account deletion is the only way to remove or anonymize the public projection.

## Consequences

- Profile reads must not require a session, while mutation and restricted-data routes remain authenticated.
- Profile queries must distinguish public historic participation from live private-room participant data.
- Account deletion must remove or anonymize public profile identity and history according to ADR 0004.
