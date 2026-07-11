# ADR 0093: Show bounded rich Public Profile search results

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Home search returns Public Profiles separately from Active Rooms. Identity-only results would make common or duplicate Discord display names difficult to distinguish, while reproducing full profiles inline would make discovery unbounded.

## Decision

Each Public Profile result shows the Discord-mirrored avatar and display name, compact aggregate usage statistics, the three most recent Past Streams, and the top three co-users by concurrent room-membership time.

The entire result is one accessible link to the matched public profile. Past Stream and co-user excerpts are non-interactive context inside that link, not nested navigation targets. Missing history/co-users collapse cleanly without placeholder rows, and all exposed data is identical to data already allowed on the full public profile.

Profile results form their own uniform group after the Active Rooms group. Rich content does not change text-match ordering and does not include live hidden participant data, chat, transcripts, reports, sanctions, private preferences, media, or private account state.

## Consequences

- Searchers can distinguish similar identities without opening every profile.
- Every result remains bounded to three history items and three co-users.
- The card has one predictable focus target despite its richer visual content.
- Loading must avoid one request per result; search data should supply the bounded preview projection in bulk.
