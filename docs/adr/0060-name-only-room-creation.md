# ADR 0060: Require only a room name at creation

- **Status:** Accepted
- **Date:** 2026-07-10
- **Amended:** 2026-07-28 — V1 now provides a bounded 140-character room description. This reverses the original "no long-form room description" clause; the name, category, tag, and no-taxonomy rules are unchanged.

## Context

First-room activation and ad-hoc social rooms should not be blocked by taxonomy work. Discovery still benefits from metadata when a Host chooses to provide it.

## Decision

Create Room requires only a trimmed room name of 3–80 user-visible characters. Category is optional freeform text of up to 32 user-visible characters, and a Host may add up to five optional freeform tags of up to 24 user-visible characters each. V1 provides no predefined taxonomy.

A room also carries one optional description: freeform plain text of up to 140 user-visible characters on a single line, normalized like every other authored room field. It is a blurb, not a document—140 characters is what the discovery card can show without truncation, and the cap exists to keep it that way. Line breaks collapse to spaces. Creation never requires it.

The description is display-only. In-app search continues to cover names, categories, tags, and public-profile identity and does not read the description, so the field cannot be used to buy discovery placement.

The existing Host room-settings control may update name, category, tags, and description later, including clearing the description outright.

The original decision withheld a description to keep a larger persistent, searchable, and moderatable content surface out of V1. That cost is accepted rather than avoided: a room already carries up to ~232 characters of authored name, category, and tag text on the same anonymous-readable surfaces, so this roughly doubles an existing surface rather than opening a new one, and keeping the field out of search removes the incentive that makes free-text abuse worthwhile.

## Consequences

- A room with no category or tags remains valid and discoverable through the normal activity-ranked list and its name.
- Category/tag filters exclude rooms that do not carry matching metadata; they never block creation.
- The description is permanent public authored text: it survives the room's end on the Past Stream summary and survives its author's account deletion with attribution anonymized. Its only moderation paths are the Host clearing it and an ADR 0008 room report reaching a Platform Admin, whose review is best effort under ADR 0025. V1 accepts that gap knowingly; it is not an oversight to be discovered later.
- A room with no description renders exactly as it did before, so no surface may depend on the field being present.
- Length is enforced where every other authored room field is enforced—in room input normalization, by grapheme count—not by a database constraint.
