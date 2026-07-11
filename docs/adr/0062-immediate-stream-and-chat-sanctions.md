# ADR 0062: Enforce stream and chat sanctions immediately

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

Platform sanctions have narrower scopes than all-access removal. They must still take effect against a currently active Stream or chat composer rather than waiting for a voluntary room exit.

## Decision

A streaming Platform Sanction immediately stops every active Stream owned by the Account and blocks new Stream starts while it is effective. A chat Platform Sanction immediately blocks new chat sends while it is effective; previously persisted chat remains unchanged.

Neither narrow sanction removes the Account's room membership, presence, or Host authority by itself. Room-creation sanctions block new creation attempts only.

## Consequences

- Viewers receive ordinary Stream-stopped state for sanction-ended media without exposing unnecessary sanction details.
- The client must update command affordances from authoritative sanction state, not just reject future clicks.
- Account deletion/redaction and Room Transcript retention remain the only mechanisms that alter already persisted chat.
