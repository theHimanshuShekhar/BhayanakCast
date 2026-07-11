# ADR 0033: Index the home page and full public profiles, not rooms

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Anonymous visitors can browse discovery and full public profiles. Search visibility must balance product discoverability with keeping individual room activity out of broad web search.

## Decision

Search engines may index the public home/discovery page and the full public profile projection: Discord-mirrored identity, aggregate statistics, Past Stream history, and top co-users. Individual room URLs, including a room's ended/Past Stream state, are noindex. The same profile content is served to crawlers and direct visitors.

## Consequences

- No crawler-specific profile projection or bot-detection behavior is required.
- Search indexing of the home page may expose the current dynamic card content shown there; individual room URLs remain unavailable as indexed landing pages.
- Authenticated-only, admin, deletion, and API surfaces are not search-indexable content.
