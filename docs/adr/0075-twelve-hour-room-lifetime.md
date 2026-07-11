# ADR 0075: Cap live rooms at twelve hours

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

A room otherwise remains live as long as membership keeps it active. A hard lifetime bounds stale or effectively permanent live state and gives operations a predictable session ceiling.

## Decision

A room may remain live for at most twelve hours from its original creation time. The deadline does not reset on Host transfer, empty-room revival, reconnect, metadata/privacy change, or other live activity, and V1 has no extension control.

Members see persistent countdown state and canonical Activity warnings at 30 minutes, 10 minutes, and 1 minute before expiry. At the deadline, the server stops all Streams, clears subscriptions, closes memberships, and transitions directly to the normal Past Stream/history records without reconnect or empty-room grace.

## Consequences

- Anyone who wants to continue must create and explicitly join a new room.
- The stable room URL becomes its ordinary noindex Past Stream summary.
- Forced expiry uses generic room-ended messaging and preserves normal transcript, aggregate, report-evidence, deletion, and audit rules.
