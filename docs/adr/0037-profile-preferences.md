# ADR 0037: Keep account preferences on the current-user profile

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

V1 has persistent account-level chat mutes and a theme override, but the public URL contract retains `/profile` as the current-user route and has no required `/settings` route.

## Decision

The authenticated `/profile` page includes a private Preferences section for managing muted Accounts and the persisted theme preference. No dedicated settings route is required.

## Consequences

- Public `/users/:userId` profiles never expose another Account's preferences or mute list.
- The Profile route retains both public-profile/activity content and private account-management content with explicit authorization boundaries.
- The visual redesign must make private preferences discoverable without implying they are public profile data.
