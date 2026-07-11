# ADR 0050: Keep sent room chat immutable

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Chat is a persisted, reportable room record. Author edit/delete controls would add timing, revision, transcript, and realtime-conflict behavior without supporting the core conversation model.

## Decision

V1 provides no author edit or delete action after sending a chat message. Hosts also cannot remove messages. Account-deletion redaction and retention processing remain the only post-send content changes.

## Consequences

- The send UI must make finality clear enough to prevent accidental messages.
- Reports retain their message target until the existing retention/redaction rules apply.
- No revision history, deletion marker, or live message-mutation protocol is needed.
