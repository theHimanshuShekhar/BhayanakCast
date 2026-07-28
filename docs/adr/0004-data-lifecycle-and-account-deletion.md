# ADR 0004: Define retention and anonymization at launch

- **Status:** Accepted
- **Date:** 2026-07-10
- **Amended:** 2026-07-28 — clarifies that Past Stream metadata survives account deletion with attribution anonymized, and places the room description added by ADR 0060 in that category rather than with redacted chat.

## Context

The prior V1 documentation retained all product history indefinitely and left account deletion undefined. The rewrite requires explicit lifecycle rules for user privacy and operational safety.

## Decision

- Room transcripts are retained for 30 days after their room ends.
- Reports and frozen report-thumbnail snapshots are retained for one year after a Platform Admin resolves or dismisses the report.
- Past Stream metadata and aggregate facts have no retention limit. Account deletion anonymizes their attribution rather than removing them: the room record, its name, its category and tags, and its description survive, while the people they were attributed to do not. This is the same treatment room names have always received, and it is deliberately not the treatment chat receives.
- Sanctions and bans remain as enforcement audit history.
- A signed-in Account submits its own deletion request through a self-service flow with an explicit irreversible confirmation.
- Submission immediately hides the Account's public profile, statistics, history, and co-user visibility, and restricts the signed-in Account to read-only browsing of discovery and public profiles.
- A Platform Admin manually verifies the request on a best-effort basis; V1 has no processing-time commitment. On approval, deletion removes the profile and credentials, anonymizes public room/history attribution, and redacts chat. Reports and sanctions remain only for their retention purposes with an internal anonymized subject reference.
- A later authorization by the same Discord identity creates a fresh Account without restoring deleted profile data, history, attribution, or a general link to the deleted Account. Deletion retains a non-public one-way Discord-identity enforcement key only while an active sanction must remain enforceable; a fresh Account receives that sanction, and the key expires with the enforcement need.
- A signed-in pending Account can cancel its own request; cancellation or administrative rejection immediately restores the public projection and normal participation.

## Consequences

- Unresolved reports remain retained until a Platform Admin resolves or dismisses them; their one-year expiry clock then begins.
- Data projections must not expose anonymized internal references as public identity.
- The enforcement key must support sanction lookup without revealing the Discord ID or making deleted Account data recoverable.
- Retention jobs, deletion-request verification, and deletion/anonymization processing are launch requirements, not later operational work.
