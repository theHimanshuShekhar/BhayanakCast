# ADR 0101: Keep one watched Stream in an adaptive member mosaic

- **Status:** Accepted
- **Date:** 2026-07-11
- **Amended:** 2026-08-08 — the desktop/medium watched tile is a full-width stage in the mosaic's first row rather than a two-column-by-two-row feature span. A 2×2 span left the chosen Stream competing with two neighbouring cells for attention, and its intrinsic height (two media regions plus one footer) never filled the two rows its neighbours sized, leaving dead space under the stage at every member count. Full width states the single-watch constraint in the layout itself.
- **Amended:** 2026-08-09 — the initial Watch action overlays the still Preview, tile-level member menus are removed, and Report/Host actions consolidate in the companion People tab.

## Context

Each Room Member may publish one Stream, while every admitted member remains part of the social room whether streaming, watching, or chatting. Allowing one viewer to subscribe to many peer Streams would multiply client bandwidth/CPU and weaken the explicit watch boundary. An equal grid, however, would make the one actual watched Stream too small in a full room.

## Decision

A viewer may have exactly one active remote Stream Subscription. Every streaming member owns one stable mosaic tile. Before subscription, the tile displays that Stream's latest visibility-aware Preview as a non-interactive image with one persistent Watch button centered over it; neither activating the image nor the surrounding tile starts media. A footer below shows Streamer identity, Live/preview freshness, and watcher stack/count. Report and authorized Host actions live in the companion People tab instead of being duplicated on every tile. After Watch succeeds, live peer media replaces the Preview inside the same member tile; the tile takes layout precedence over every other cell while other Stream Previews and visible non-streaming members use smaller cells. Emphasis changes size and grid position of the stage only, never DOM/tile order.

Selecting Watch on another Stream first stops and clears the existing peer subscription, restores the former tile's current Preview, then begins the new connection. Failure of the new connection does not resume the previous watch. The new tile shows Connecting and bounded retry progress; exhaustion restores its Preview with manual Retry and compatibility guidance. Stream end, source change, Host stop, sanction, disconnect, leave, or admission loss clears the subscription. A later Stream always requires a new explicit Watch.

Stable mosaic order is:

1. the current viewer (`You`);
2. the current Host when different at the initial ordering point; and
3. remaining members by continuous join time, with a stable identity tie-breaker.

New members append. Host transfer and Stream state changes update labels/actions without reordering existing tiles. On desktop and medium layouts, the selected watched tile enlarges in place to a full-width stage occupying the mosaic's first row, and the remaining tiles flow beneath it in unchanged DOM/row-major order. **(Amended 2026-08-08; the original stable two-column-by-two-row feature span is withdrawn.)** The stage never takes the whole canvas: its media region caps so that the stage, its footer, and the top of the next tile row all remain visible without scrolling, because a viewer must be able to see that there is another Stream to switch to. Within that cap the media stays 16:9 and letterboxes into the same midnight ground rather than cropping. A full-width stage always has room for the single-row footer, so it uses one; only a narrow cell stacks. Other tiles retain one uniform grid cell of at least 240px width, with a 16:9 media/presence region plus the footer, and fill without dense backfilling or visual reordering. The bounded mosaic scrolls before crossing that minimum. Mobile retains its separate primary-stage-and-strip rule.

The viewer's own active Stream tile shows the browser-local capture Preview, muted locally to prevent feedback, with `You · Sharing` state. Own Start Stream and Stop Stream actions exist only in the integrated control shelf. Browser-picker cancellation/failure leaves this tile and all current remote watching unchanged.

Every watched Stream starts muted. Its tile has a persistent footer below—not over—the contained media with Streamer identity/status, watcher count, connection/retry state, explicit Unmute/Mute, Stop Watching, and native Fullscreen. Use one row when space permits. At narrow widths, use two responsive rows: identity/watcher/connection state first and media actions second. Never introduce horizontal footer scrolling or hide these controls in More. The controls remain visible and reachable by touch, keyboard, and pointer; shared content is never obscured by auto-hiding overlays. Switching Streams always starts the new watch muted. V1 has no Picture-in-Picture or application playback mixer.

A streaming tile shows an informational watcher stack to admitted members: up to three watcher avatars plus the total watcher count. It creates no popover/focus target. Watchers are ordered by watch start for stable visible avatars; the accessible label identifies the visible Accounts and total count.

The whole watch lifecycle is announced in one polite live region owned by the mosaic: connecting with its bounded attempt count, connected and muted, exhaustion with the recovery guidance, and stopped. Each Watch, Retry, Cancel, and Stop Watching control names its member in its accessible name, and each tile is labelled by its member's name, because a grid of controls reading only `Watch` is unusable in an element list. A Watch that cannot run is `aria-disabled` rather than `disabled` — it stays reachable and carries a visible reason naming which of the four blocking conditions applies: probing, an incompatible client, a room reconnect, or a room that has ended. Native fullscreen falls back to the WebKit video entry point so the control is real on the iOS clients ADR 0014 supports, and reports its own failure in the tile when neither path exists.

A tile never asserts a state the client cannot support. If the roster still carries the viewer's own Stream after local capture has gone, the tile reads `Screen stopped` and returns to the presence treatment rather than showing a stale thumbnail labelled `Live`. A Preview that fails to load falls back to the member's avatar rather than an empty frame.

All member tiles are visible by default. A non-streaming member uses a presence tile anchored by their real avatar, with a footer showing name and Host/You/reconnecting/compatibility state. Report and authorized Host actions remain available from that member's row in People. A presence tile never uses camera-off iconography or styling that implies webcam/video. A viewer-local `Hide non-streaming participants` checkbox removes only these presence tiles from that viewer's mosaic for the current room session. It does not persist, affect other viewers, alter server state, or remove anyone from People. If no Stream is active, retain the member mosaic and show a restrained `No one is sharing yet` prompt in unused canvas space; for a compatible viewer, it points to Start Stream in the bottom shelf rather than duplicating that control.

Stream Previews and live media remain distinct. Public-room Previews are unblurred; private-room Previews remain blurred. Explicitly watched live media is shown after authenticated private-room admission. Screen/application media always uses contain sizing rather than cropping.

## Consequences

- One viewer creates at most one remote peer media connection at a time, preserving the V1 direct-P2P capacity boundary.
- Switching is explicit and destructive to the prior subscription; UI tests must cover failure after the prior watch has stopped.
- The mosaic remains socially complete by default while allowing a temporary media-only preference.
- Tile state tests must cover Preview, Connecting, Retry, Watched-muted, Watched-audible, Fullscreen, stopped, local sharing, reconnect recovery, and hidden non-streamers.
