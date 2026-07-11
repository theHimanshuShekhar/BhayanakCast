# ADR 0101: Keep one watched Stream in an adaptive member mosaic

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Each Room Member may publish one Stream, while every admitted member remains part of the social room whether streaming, watching, or chatting. Allowing one viewer to subscribe to many peer Streams would multiply client bandwidth/CPU and weaken the explicit watch boundary. An equal grid, however, would make the one actual watched Stream too small in a full room.

## Decision

A viewer may have exactly one active remote Stream Subscription. Every streaming member owns one stable mosaic tile. Before subscription, the tile displays that Stream's latest visibility-aware Preview as a non-interactive image. A persistent footer below it shows Streamer identity, Live/preview freshness, watcher stack/count, an explicit Watch button, and a compact Report/authorized-Host menu; neither activating the image nor the tile starts media. After Watch succeeds, live peer media replaces the Preview inside the same member tile; the tile receives the largest available grid span while other Stream Previews and visible non-streaming members use smaller cells. Emphasis changes size, never DOM/tile order.

Selecting Watch on another Stream first stops and clears the existing peer subscription, restores the former tile's current Preview, then begins the new connection. Failure of the new connection does not resume the previous watch. The new tile shows Connecting and bounded retry progress; exhaustion restores its Preview with manual Retry and compatibility guidance. Stream end, source change, Host stop, sanction, disconnect, leave, or admission loss clears the subscription. A later Stream always requires a new explicit Watch.

Stable mosaic order is:

1. the current viewer (`You`);
2. the current Host when different at the initial ordering point; and
3. remaining members by continuous join time, with a stable identity tie-breaker.

New members append. Host transfer and Stream state changes update labels/actions without reordering existing tiles. On desktop and medium layouts, the selected watched tile enlarges in place to a stable two-column-by-two-row feature span. Other tiles retain one uniform grid cell of at least 240px width, with a 16:9 media/presence region plus the footer, and fill in DOM/row-major order without dense backfilling or visual reordering. The bounded mosaic scrolls before crossing that minimum. Mobile retains its separate primary-stage-and-strip rule.

The viewer's own active Stream tile shows the browser-local capture Preview, muted locally to prevent feedback, with `You · Sharing` state. Own Start Stream and Stop Stream actions exist only in the integrated control shelf. Browser-picker cancellation/failure leaves this tile and all current remote watching unchanged.

Every watched Stream starts muted. Its tile has a persistent footer below—not over—the contained media with Streamer identity/status, watcher count, connection/retry state, explicit Unmute/Mute, Stop Watching, and native Fullscreen. Use one row when space permits. At narrow widths, use two responsive rows: identity/watcher/connection state first and media actions second. Never introduce horizontal footer scrolling or hide these controls in More. The controls remain visible and reachable by touch, keyboard, and pointer; shared content is never obscured by auto-hiding overlays. Switching Streams always starts the new watch muted. V1 has no Picture-in-Picture or application playback mixer.

A streaming tile shows an informational watcher stack to admitted members: up to three watcher avatars plus the total watcher count. It creates no popover/focus target. Watchers are ordered by watch start for stable visible avatars; the accessible label identifies the visible Accounts and total count.

All member tiles are visible by default. A non-streaming member uses a presence tile anchored by their real avatar, with a footer showing name, Host/You/reconnecting/compatibility state, and the compact Report/authorized-Host menu. It never uses camera-off iconography or styling that implies webcam/video. A viewer-local `Hide non-streaming participants` checkbox removes only these presence tiles from that viewer's mosaic for the current room session. It does not persist, affect other viewers, alter server state, or remove anyone from People. If no Stream is active, retain the member mosaic and show a restrained `No one is sharing yet` prompt in unused canvas space; for a compatible viewer, it points to Start Stream in the bottom shelf rather than duplicating the action. Never replace people with fake media or an illustration.

Stream Previews and live media remain distinct. Public-room Previews are unblurred; private-room Previews remain blurred. Explicitly watched live media is shown after authenticated private-room admission. Screen/application media always uses contain sizing rather than cropping.

## Consequences

- One viewer creates at most one remote peer media connection at a time, preserving the V1 direct-P2P capacity boundary.
- Switching is explicit and destructive to the prior subscription; UI tests must cover failure after the prior watch has stopped.
- The mosaic remains socially complete by default while allowing a temporary media-only preference.
- Tile state tests must cover Preview, Connecting, Retry, Watched-muted, Watched-audible, Fullscreen, stopped, local sharing, reconnect recovery, and hidden non-streamers.
