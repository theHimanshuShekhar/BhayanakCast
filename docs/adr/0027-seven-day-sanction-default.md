# ADR 0027: Default Platform Sanctions to seven days

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Platform Admin sanctions may block streaming, chat, room creation, or all account access. An implicit indefinite default is disproportionate for a best-effort small-community moderation model.

## Decision

New Platform Sanctions default to a seven-day expiry. A Platform Admin may explicitly choose a different expiry or indefinite duration, and may lift a sanction early.

## Consequences

- The admin sanction form must make the default and any indefinite choice explicit.
- Effective-sanction checks must respect expiry, manual lift, type, and start time.
- The seven-day default does not constrain the separate Room Ban lifecycle, which ends when cleared or when its room ends.
