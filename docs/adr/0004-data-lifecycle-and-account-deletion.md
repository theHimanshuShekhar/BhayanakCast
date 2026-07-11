# ADR 0004: Define retention and anonymization at launch

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The prior V1 documentation retained all product history indefinitely and left account deletion undefined. The rewrite requires explicit lifecycle rules for user privacy and operational safety.

## Decision

- Room transcripts are retained for 30 days after their room ends.
- Reports and frozen report-thumbnail snapshots are retained for one year after a Platform Admin resolves or dismisses the report.
- Past Stream metadata and aggregate facts remain until account deletion.
- Sanctions and bans remain as enforcement audit history.
- A signed-in Account submits its own deletion request through a self-service flow with an explicit irreversible confirmation.
- Submission immediately hides the Account's public profile, statistics, history, and co-user visibility, and restricts the signed-in Account to read-only browsing of discovery and public profiles.
- A Platform Admin manually verifies the request on a best-effort basis; V1 has no processing-time commitment. On approval, deletion removes the profile and credentials, anonymizes public room/history attribution, and redacts chat. Reports and sanctions remain only for their retention purposes with an internal anonymized subject reference.
- A signed-in pending Account can cancel its own request; cancellation or administrative rejection immediately restores the public projection and normal participation.

## Consequences

- Unresolved reports remain retained until a Platform Admin resolves or dismisses them; their one-year expiry clock then begins.
- Data projections must not expose anonymized internal references as public identity.
- Retention jobs, deletion-request verification, and deletion/anonymization processing are launch requirements, not later operational work.
