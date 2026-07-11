# ADR 0073: Transition Admin-ended rooms directly to Past Streams

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Platform Admins may end a live room as a moderation intervention. The result must stop harmful live activity immediately without deleting historical and audit context or introducing a frozen room state.

## Decision

A Platform Admin end-room action immediately stops every active Stream, clears subscriptions, closes all Room Memberships, and transitions the room directly to its normal Past Stream/history records without reconnect or empty-room grace.

Affected members receive generic room-ended messaging. The internal moderation audit identifies the Admin action, but public/member surfaces do not expose unnecessary enforcement detail.

## Consequences

- The stable room URL becomes the ordinary noindex Past Stream summary.
- Existing report evidence, Room Transcript retention, aggregate facts, and deletion/redaction rules continue normally.
- V1 has no read-only frozen-room or delayed shutdown state.
