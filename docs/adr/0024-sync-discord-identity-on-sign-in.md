# ADR 0024: Refresh Discord identity on every sign-in

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

BhayanakCast uses Discord identity rather than a local username or profile-edit system. Public profiles need a clear freshness rule for display name and avatar.

## Decision

Refresh an Account's Discord-mirrored display name and avatar whenever it completes Discord sign-in. V1 has no manual profile edit or background identity-sync job.

## Consequences

- A user can update public identity by changing it in Discord and signing in again.
- Public profile and room/member projections use the stored refreshed identity, not live browser-supplied values.
- Identity refresh does not change account IDs, membership history, reports, sanctions, or audit attribution.
