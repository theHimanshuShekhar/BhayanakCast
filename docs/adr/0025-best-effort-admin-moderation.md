# ADR 0025: Treat Platform Admin moderation as best effort

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

BhayanakCast launches with a static, small Platform Admin operating model rather than staffed continuous moderation coverage.

## Decision

All Platform Admin moderation work is best effort and has no response-time commitment. This includes reviewing/resolving reports, creating/lifting sanctions, and ending live rooms.

## Consequences

- The product must not promise immediate review, enforcement, or intervention in copy, notifications, or policy surfaces.
- Admin operations must remain auditable and actionable whenever an authorized operator is available.
- A future service-level objective or staffed moderation model requires a new decision.
