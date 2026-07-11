# ADR 0071: Load the latest 50 chat messages on room admission

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

A newly admitted member needs enough conversation context to participate, while the live room should not become a paginated transcript browser. Persisted chat also serves the separately authorized post-room transcript.

## Decision

On successful first admission to a live room, load at most the 50 most recent persisted chat messages in canonical order. New messages then arrive through the normal realtime flow.

V1 provides no live-chat pagination or request for older messages. A reconnect-grace reclaim restores membership but does not backfill messages missed during the transient disconnect.

## Consequences

- Rooms with fewer than 50 persisted messages load all available messages.
- The post-room Room Transcript remains a separate historical Host/Platform Admin surface and is not constrained to this live window.
- Message mutes apply when presenting both the initial live window and subsequent realtime messages.
