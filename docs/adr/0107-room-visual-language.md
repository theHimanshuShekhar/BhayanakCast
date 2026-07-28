# ADR 0107: Adopt the 4a room design as visual language only, subordinate to 0100–0103

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

`docs/design/Home Uplift.dc.html` carries a room composition, option 4a "Rail Spotlight" (`:54`), drawn as a visual proposal without reference to the admitted-room ADRs. ADRs `0100`–`0103` already decide that room's structure, emphasis model, control placement, and responsive behaviour. Read side by side the two disagree in five places, and each disagreement is one the design loses on structure but wins on surface: 4a is a stronger *rendering* of the room than anything the ADRs specify, because the ADRs specify no rendering at all.

Leaving the disagreements unrecorded would let whoever writes the room page pick per-component, silently, and produce a room that is neither. Home has already shown the cost of this: a preview-overflow cell was built from the same design file and shipped against ADR `0084` before review caught it.

## Decision

The 4a design is adopted as the room's **visual language**—type, colour, spacing, radius, elevation, motion, and the token bundle at `docs/design/_ds/nocturne-b11143e3-fb4f-4bff-8152-e5bd69e2e093/styles.css`—and is adopted for **nothing structural**. Where 4a and `0100`–`0103` disagree about layout, emphasis, control placement, or state, the ADR governs and the design supplies only the styling of whatever the ADR mandates. Design mockups are not a source of truth for structure and never supersede an ADR by being newer.

The five known disagreements resolve as follows.

**Companion rail width.** 4a draws a fixed 320px chat/people/activity rail (`:131`). `0100` decides a persistent 360px right companion dock at 1280px and above, and a non-modal right workspace drawer at 768–1279px. Build 360px and the drawer; take 4a's rail *styling*—surface, divider, tab treatment, badge form—at that width. There is no fixed-rail-at-all-widths presentation.

**Watched-Stream emphasis.** 4a draws a spotlight tile above a thumbnail strip on desktop. `0101` decides the watched tile enlarges **in place** to a stable 2×2 feature span, with stable tile order and no reflow, and `0103` makes the primary-stage-plus-strip composition the rule below 768px. Desktop and 768–1279px use in-place enlargement. 4a's spotlight composition is retained as the **<768px** presentation and is styled from the mockup there.

**Tile footers.** 4a's tiles carry name and status only. `0101` and `0102` require every tile to carry a persistent footer *below* the media—not overlaid—with Streamer identity and Live/preview freshness, watcher stack and count, connection/retry state, Watch or Mute/Unmute plus Stop Watching plus native Fullscreen once watched, and the compact Report / authorized-Host menu. These are safety and control surfaces: they are never behind hover, never in a More overflow, and never horizontally scrolled. At narrow widths they wrap to two rows per `0101`. The mockup's tile chrome styles this footer; it does not reduce it.

**Compatibility state.** 4a shows none. `0103` requires a persistent compact inline banner above the control shelf or room bar for a member who fails the Compatibility Gate, with Retry and recovery guidance, and requires the mobile Stream control to remain visible but disabled as `Desktop only` with a help affordance. Build both, styled with the design's tokens; the banner is not a toast, not a modal, and not dismissible.

**Hide non-streaming participants.** 4a has no such control. `0101` requires a viewer-local checkbox that removes presence tiles from that viewer's mosaic for the current room session only. Build it, in overview and strip alike per `0103`.

Where 4a specifies a typeface, ADR `0096` governs: self-hosted Source Sans 3, not the mockup's Inter.

## Consequences

- The room page can be built from 4a directly for everything visual, with no further per-component adjudication; the five structural questions are closed.
- The <768px layout and the ≥768px layout differ in emphasis model, not only in size. Tests must cover in-place 2×2 enlargement above the breakpoint and stage-plus-strip below it as distinct behaviours.
- Tile footers make tiles taller than the mockup's, which is the binding constraint on minimum cell size (`0100`: scroll before a normal cell falls below 240px wide). Fitting more tiles by trimming footer controls is not available.
- Any future design import must be audited against the ADRs covering every surface it touches before implementation, not after.
- Reopening one of these five requires superseding the governing ADR, not reinterpreting the mockup.
