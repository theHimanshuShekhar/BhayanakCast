# ADR 0001: Preserve the documented V1 product contract

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The rewrite branch starts with an empty working tree. The `main` branch documents BhayanakCast V1 as a Discord-authenticated public discovery platform for small social screen-sharing rooms, including room lifecycle, streaming, privacy, moderation, profiles, and operations.

## Decision

The rewrite preserves the documented V1 functional contract. Technical architecture and UI implementation may change, but no documented V1 behavior is removed, weakened, or expanded without a later confirmed requirements decision.

## Consequences

- The main-branch glossary and behavioral documentation remain the baseline while this requirements interview produces the rewrite's own source-of-truth documents.
- Future decisions will distinguish product invariants from replaceable implementation choices.
