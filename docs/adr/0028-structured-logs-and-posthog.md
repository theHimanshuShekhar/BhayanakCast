# ADR 0028: Use structured operational logs and PostHog analytics

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The single-node production service needs operational visibility, while launch engagement is observed qualitatively and still benefits from product telemetry.

## Decision

Retain all necessary structured operational logs and add a self-hosted PostHog deployment in the operator's homelab for product analytics. PostHog tracks anonymous public discovery and signed-in use without an in-product analytics opt-in; after Discord sign-in, activity is associated with the raw Discord account ID. Event design must still follow the application logging sensitive-data boundary: never send private-room passwords or hashes, credentials, OAuth/session material, chat bodies, thumbnail bytes, report-snapshot bytes, or full database/Valkey URLs.

PostHog retains analytics for one year. On approved Account deletion, it removes the raw Discord ID/person association while retaining anonymized aggregate events for the remainder of their retention period.

PostHog receives every non-content user interaction, including administrative and moderation actions. Operational logs remain the audit source of truth for those actions.

Except for the approved raw Discord ID, PostHog excludes identity/profile fields, private-room passwords, room names, chat, reports, and media. It may record room categories/tags and selected non-sensitive UI labels; the event inventory must enumerate every allowed property.

## Consequences

- The rewrite needs a documented PostHog event inventory, retention policy, privacy disclosure, homelab resource/backup plan, and failure-isolation behavior before telemetry implementation.
- Operational logs remain the source of truth for incidents and moderation audit events; PostHog does not replace them.
- Product analytics integration must not block critical room, media, authentication, or moderation paths.
