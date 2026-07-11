# ADR 0031: Launch the rewrite with a fresh PostgreSQL database

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The implementation and realtime protocol are clean-cutover internals. Carrying old persistence forward would add an unrequested migration and compatibility surface.

## Decision

The rewrite launches against a fresh PostgreSQL schema and data store. It does not migrate prior accounts, rooms, memberships, streams, transcripts, reports, sanctions, aggregate facts, or analytics associations.

## Consequences

- New Better Auth/Discord sign-ins create the rewrite's Account records.
- Product history, moderation records, and profile aggregates begin at rewrite launch.
- Existing database backups remain separate operational artifacts and must not be attached to the new runtime as a migration fallback.
