# ADR 0103: Use contextual mobile room controls and explicit recovery states

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

The admitted room needs a phone composition that preserves watched media and live companions without stacking the global bottom navigation, room controls, and keyboard. Compatibility failure, reconnect grace, forced departure, and room end must also replace stale media state explicitly rather than leaving a dead room shell.

## Decision

### Small-screen shell

Below 768px, the admitted room replaces the global Home/Create/Profile bottom navigation with one fixed, safe-area-aware room control bar. It exposes Stream, Chat, People, Activity, and Leave/More. Back/Home remains explicit in the room header. On watch-capable but stream-creation-incompatible mobile clients, Stream remains visible but disabled as `Desktop only`; a help affordance explains the Chromium-family desktop requirement.

The compact mobile header shows Back, a truncated room name, privacy state, and lifetime countdown. A labeled Details action opens a sheet containing category/tags, current Host, member/Stream counts, and authorized Settings. Do not horizontally scroll core metadata.

With no active remote watch, use a two-column overview mosaic. Once Watch succeeds, the watched tile becomes the primary stage and the remaining Stream Previews/non-streaming tiles move to a labeled horizontal strip beneath it. `Hide non-streaming participants` applies to overview and strip. The primary tile keeps a persistent footer below the media with Streamer identity/status, connection/retry, Mute/Unmute, Stop Watching, watcher stack/count, and native Fullscreen. At narrow widths it uses two rows—identity/watcher/connection state first and media actions second—with no horizontal scrolling or More-menu overflow; do not hide controls behind hover or overlay them on shared content.

Chat, People, Activity, and Details use accessible bottom sheets. Companion sheets open at approximately 55% height so media remains visible and provide labeled Expand/Collapse controls for approximately 90%. Chat expands when necessary for the on-screen keyboard. Dragging may supplement but never replace these controls. Dismissal and sheet switching restore focus to the invoking room-bar/header control.

At 768–1279px, the room retains the 72px application rail and fixed workspace, but Chat/People/Activity open as a non-modal right workspace drawer rather than the persistent 360px dock used at 1280px and above. Do not dim, inert, pause, or reflow the mosaic. The drawer owns independent scrolling, an explicit Close action, Escape dismissal, and focus return to its invoking tab; uncovered media controls remain usable, and focused mosaic controls scroll clear of the drawer.

### Compatibility and media failure

A member who fails the direct-media Compatibility Gate sees a persistent compact inline banner above the control shelf/room bar explaining that Chat and presence remain available, with Retry compatibility and recovery guidance. Start/Watch controls remain visibly disabled with the same reason; Stream Previews and companions remain usable. Do not block admission with a modal.

On a supported capture client, the bottom-shelf Stream slot progresses Start Stream → `Starting…` with Cancel during local setup → Stop Stream after canonical acknowledgement. Capture cancellation/denial/failure returns that slot to Start with inline guidance and creates no Stream state. Mobile keeps the same destination visible but disabled as `Desktop only`. Watch connection states remain inside the selected tile: Connecting, retry timing, manual Retry, and current Preview. Status changes use polite announcements without moving focus.

### Reconnect and invalid membership

During an unexpected connection loss, freeze the last non-sensitive room presentation, mark it Reconnecting with the remaining 45-second grace, disable chat/media mutations, and close active peer media immediately. If membership is reclaimed, refresh canonical room state and restore presence/chat context without backfill. The former watched tile returns to Preview and requires explicit Watch again; the member's former Stream remains stopped and requires explicit Start Stream.

Kick, Room Ban, account-connection displacement, all-access sanction, admission loss, or another forced departure clears local Stream/subscription/chat/dock state and replaces the admitted room with the same URL's pre-admission boundary. Kick may expose Join again when current gates allow. Ban shows unavailable. Connection displacement explains that the Account is active elsewhere and must never auto-reconnect to displace the newer connection. Do not leave invalid room content visible behind a modal.

### Room end

The header keeps the canonical 12-hour countdown visible. Thirty-, ten-, and one-minute warnings appear both as restrained persistent countdown emphasis and canonical Activity events; only the one-minute state uses warning-level prominence. On lifetime expiry or Platform Admin termination, stop media, close/disable composers and companion sheets, show generic Room ended state, and transition in place at the stable room URL to the noindex Past Stream summary. Never expose enforcement detail.

### No-Stream and leaving states

With no active Streams, preserve member tiles and the quiet `No one is sharing yet` prompt rather than expanding Chat or replacing the mosaic. Ordinary non-Host/non-streamer Leave acts immediately. Host or active-streamer Leave uses the existing focused confirmation that names Host transfer and/or Stream stop. Leaving always clears the room-session hide/dock/tab/unread state.

## Consequences

- Mobile has one reachable fixed action surface rather than competing global and room bars.
- Watching remains visible while members use companions, with explicit expansion for content-heavy work.
- Recovery never implies uninterrupted peer media or silently resumes captured content.
- Forced-departure and end states reuse the stable room URL while respecting admission and Past Stream contracts.
- Responsive tests must cover safe areas, keyboard, both sheet heights, focus return, medium drawer, chat-only compatibility, reconnect reclaim/expiry, forced departure, and in-place room end.
