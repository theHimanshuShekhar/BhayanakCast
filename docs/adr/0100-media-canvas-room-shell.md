# ADR 0100: Use a media-canvas Stream Room shell

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

The admitted room must keep peer media visually dominant while preserving room identity, lifecycle state, global navigation, chat, People, Activity, and controls. A general scrolling document or three persistent social columns would make simultaneous member tiles too small and separate controls from the media they affect.

## Decision

Use a fixed-viewport admitted-room workspace on desktop. It contains:

1. a 72px icon-only application rail with accessible labels/tooltips;
2. a compact two-line room header;
3. the primary media canvas;
4. an integrated control shelf directly below the canvas; and
5. at 1280px and above, a persistent 360px right companion dock.

The room header's first line contains Back/Home, room name, Public/Private and Full/live state, and Host-only Settings. Its second line contains category/tags, current Host avatar/name, member and active Stream counts, and the persistent 12-hour lifetime countdown. Leave belongs in the control shelf rather than competing with room identity.

The media canvas and companion content may scroll within their bounded workspace regions; the ordinary desktop room has no document scroll. Header and control shelf remain available. The mosaic uses stable tile order and scrolls before a normal grid cell would fall below 240px wide; each cell's visual region targets 16:9 and its footer adds height outside that region. Chat, People, and Activity own bounded scrolling appropriate to live work surfaces.

The persistent companion dock opens to Chat and provides Chat, People, and Activity tabs. It may collapse to a narrow icon rail with unread/status badges; activating a tab reopens it. Active tab, draft, scroll, and collapse state last only for the current room session. At 768–1279px, retain the 72px app rail but present the active companion as a non-modal right workspace drawer instead of permanently consuming media width. It has no scrim, focus trap, media pause, or grid reflow; explicit Close and Escape restore focus to the invoking tab. Uncovered media controls remain usable, and keyboard focus moving to a mosaic control scrolls that target clear of the drawer rather than leaving focus visibly obscured.

Use the midnight dark media canvas in both product themes. Video, previews, and tile gutters remain on that dark surface; app rail, header, companion dock, dialogs, and control shelf honor the selected porcelain or midnight theme. Stream media uses `object-fit: contain` on a dark letterbox surface and is never cropped to fill.

The control shelf is a structural surface, not a floating conferencing pill. It always contains the viewer's single stateful own-Stream slot—Start Stream, then `Starting…` with Cancel during local setup, then Stop Stream after canonical acknowledgement—plus compatibility state and Leave. Cancel/failure returns the slot to Start with inline guidance. Own publishing controls never move into the local tile or follow tile selection. Every remote-watch control—connection state, Mute/Unmute, Stop Watching, and Fullscreen—remains on the watched Streamer's mosaic tile. Host moderation remains contextual in People/tile menus.

## Consequences

- The room has purpose-built nested scroll regions, unlike Home's single-document-scroll discovery surface.
- Media remains dominant without hiding persistent social and lifecycle context.
- The app rail is intentionally compact even on wide room layouts to reserve width for media and the companion dock.
- Short viewport, zoom, keyboard, focus, and reduced-motion tests must prove that header/shelf controls never become unreachable.
