# ADR 0036: Require terms acknowledgement only for account deletion

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The product permits any Discord-authenticated Account to participate. The community/content policy must be visible, but an additional participation gate would add onboarding friction.

## Decision

Discord sign-in is sufficient to create or join rooms; V1 has no separate community-rules or terms-acceptance gate for participation. The account-deletion flow presents the relevant terms alongside its irreversible confirmation.

## Consequences

- General-audience rules remain discoverable and enforceable through reports, Host controls, and Platform Sanctions without an acceptance-record table.
- The deletion confirmation must clearly state its consequence and applicable terms.
- A later policy-version or age/terms acceptance requirement needs a new onboarding/data decision.
