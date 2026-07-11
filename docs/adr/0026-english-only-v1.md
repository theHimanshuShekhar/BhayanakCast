# ADR 0026: Ship V1 in English only

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The product is a public community clubhouse, but no launch-market localization requirement has been identified.

## Decision

V1 ships product copy, moderation taxonomy, and user flows in English only. Storage and display remain Unicode-safe, but V1 does not require translated copy, locale-specific formatting, or localization infrastructure.

## Consequences

- Moderation policy and error copy need one clear English source of truth.
- A later language launch requires a dedicated content, translation, and moderation-policy decision.
- User-provided display names, room names, chat, categories, and tags are not restricted to English by this decision.
