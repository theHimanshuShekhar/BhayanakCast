# ADR 0060: Require only a room name at creation

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

First-room activation and ad-hoc social rooms should not be blocked by taxonomy work. Discovery still benefits from metadata when a Host chooses to provide it.

## Decision

Create Room requires only a trimmed room name of 3–80 user-visible characters. Category is optional freeform text of up to 32 user-visible characters, and a Host may add up to five optional freeform tags of up to 24 user-visible characters each. V1 provides no long-form room description or predefined taxonomy.

The existing Host room-settings control may update name, category, and tags later.

## Consequences

- A room with no category or tags remains valid and discoverable through the normal activity-ranked list and its name.
- Category/tag filters exclude rooms that do not carry matching metadata; they never block creation.
- Avoiding a description field keeps a larger persistent, searchable, and moderatable content surface out of V1.
