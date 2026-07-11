# ADR 0008: Use structured reports with an internal review queue

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Any Discord-authenticated account may participate at launch. The platform needs usable safety reporting without adding a public moderation case-management product or an appeals workflow in V1.

## Decision

Reports target an account, room, stream, or chat message. The reporter selects one top-level reason:

- harassment or hate;
- sexual or explicit content;
- violence, threats, or self-harm;
- privacy or impersonation;
- spam or scam;
- copyright; or
- other, with required details.

Platform Admins review reports in an internal queue on a best-effort basis; V1 has no response-time commitment, reporter-facing status, resolution notification, or appeal workflow.

## Consequences

- Report forms must require enough target context for a Platform Admin to act and must keep the report contents private.
- Stream reports retain the documented frozen blurred-thumbnail evidence path when a current thumbnail exists.
- Any future reporter notification or appeal capability requires a new workflow decision.
