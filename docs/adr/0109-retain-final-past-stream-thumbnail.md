# ADR 0109: Retain a final Past Stream thumbnail

- **Status:** Accepted
- **Date:** 2026-08-09
- **Amends:** ADR `0085` and ADR `0035`

## Context

Past Stream cards are text-only even when a Room produced Stream Previews. The live preview bytes cannot supply a thumbnail after the Room ends: Valkey holds them temporarily, and stopping a Stream deletes its preview before the Room may become a Past Stream. ADR `0085` forbids preview images on Past Stream items, while ADR `0035` makes preview keys live-only.

A final still image can make recent public history easier to scan without adding replay media. It must not weaken the existing private-room boundary or move durable history outside the PostgreSQL backup and restore boundary.

## Decision

Retain at most one final thumbnail per Room in PostgreSQL: the freshest Stream Preview captured while the Room was public. Archive the thumbnail at capture time, not at room-end time, because a Stream that stops before its Room ends has already had its Valkey bytes deleted. The archived row lives as long as the Past Stream record unless approved Account deletion removes content produced by the originating Stream owner.

A private-room capture is never archived. This keeps privacy a property of the stored data, as ADR `0035` does with the private preview width cap, rather than relying on presentation. Changing a public Room to private removes its archived thumbnail; later public captures may create a new archive.

A public Past Stream with an archived capture may show the real thumbnail. A private Past Stream that had Streams may show a CSS-only blurred placeholder, with no archived or requested image. A Past Stream without an eligible capture has no media block. None of these treatments adds replay.

ADR `0085` is amended to permit this optional media block while retaining its bans on carousels, pagination, and table treatment. ADR `0035` is amended so a public preview may outlive its Stream only as this separate archived Past Stream thumbnail; live preview keys remain live-only, and private preview bytes never enter the archive.

ADR `0023` excluded preview bytes from the database recovery guarantee. Storing archived thumbnails in PostgreSQL narrows that exclusion: archived Past Stream thumbnails are included in the daily database backup and monthly restore drill, while live Valkey preview bytes remain excluded.

## Consequences

- Public Past Stream history may show one non-replayable still image per Room.
- Private Past Streams disclose only that a Stream existed, through a CSS-only placeholder; no private capture is retained or served.
- Archiving adds one bounded PostgreSQL row per Room and one upsert per accepted public preview capture.
- The archive survives Stream stop and every Room end path without adding Valkey work to room-end transactions.
- Archived thumbnails share the Past Stream data lifecycle and PostgreSQL recovery boundary.
- Live Stream Preview URLs, cadence, validation, rate limits, storage, and serving rules remain unchanged.
