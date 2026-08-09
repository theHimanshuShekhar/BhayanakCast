# BhayanakCast Design Brief

## North star

BhayanakCast is a **community clubhouse**: people browse an active public community and move between social screen-sharing rooms. The product should feel welcoming, lively, and easy to scan—not like a broadcast studio or a dense operations console.

Accepted ADRs define structure and behavior. Files under `docs/design/` are visual explorations only: reuse their visual language where it agrees with this brief, but do not inherit conflicting layout, typography, controls, or product concepts.

## Functional interface invariants

- Live room state, capacity, privacy, host authority, stream availability, and watch state must remain clear before decoration.
- Public/private admission and moderator authority must be explicit and never hover-only.
- Every dialog, menu, tab, room control, moderation control, and authentication action must be keyboard operable with visible focus.
- Body and placeholder text must meet WCAG 2.2 AA contrast against actual surfaces.
- Reduced motion must preserve state feedback while removing non-essential animation.
- The room UI must support the defined mobile watch/chat clients.

## Theme

V1 ships intentional light and dark themes. Both modes must preserve the same hierarchy, state clarity, contrast, focus treatment, and reduced-motion behavior. A context-specific dark media surface is permitted in either theme when it improves watching. The initial theme follows the device preference; a visible user control persists a light/dark override.

## Color strategy

Use the exact porcelain/midnight tokens from ADR 0096. Light anchors: canvas `#F6F8FC`, surface `#FFFFFF`, text `#172033`, cobalt `#2457D6`. Dark anchors: canvas `#0D1422`, surface `#141D2D`, text `#F4F7FC`, cobalt `#82A5FF` with dark action text `#0B1630`. Secondary/muted/border and cobalt-soft/hover values are likewise fixed in ADR 0096.

Semantic families remain distinct from cobalt and from each other: light/dark Live `#C52B69`/`#FF72A5`, Host/success `#147A5A`/`#55D5A9`, warning `#946000`/`#F2B84B`, danger `#B83232`/`#FF7B72`, and private `#6842B8`/`#B99AFF`. Never rely on hue without text/icon state.

## Typography

Self-host Source Sans 3 variable WOFF2 assets and use the family across display, UI, chat, statistics, and body copy, with tabular numerals for live counts. Fixed scale: 13px minimum labels, 14px metadata, 16px body/controls, 18px normal card titles, 24px section titles, 30px featured title, and 36px rare page headings.

## Density

Use adaptive density by surface: discovery should feel welcoming and breathable, while live room people/chat/controls become compact enough to keep the social state visible.

## Home composition

Home uses three composition stages while preserving center order. At 1280px above, show persistent left sidebar, fluid center discovery column, right utility rail. At 768–1279px, keep compact left sidebar, remove right rail, collapse global statistics within search utilities. Below 768px, replace both rails with a compact top brand bar containing `B`, live connected-people count, and an avatar only when signed in; persistent bottom navigation shows Home, Create, and Profile for signed-in visitors or `Discord` for anonymous visitors. The anonymous `Discord` control visibly reads `Discord`, has the full accessible name `Continue with Discord`, and starts full-page Discord OAuth directly, returning Home. Fixed small-stage bars respect safe areas, visible focus, 44px targets, and content clearance.

At wide widths, center frame capped 1600px: 216px left rail, fluid 640–1040px center, 280px right rail, 24px gaps/padding. Medium uses 72px icon rail and least 16px center gutters; an anonymous dedicated Discord affordance may use the Discord mark alone only with accessible name and hover/focus tooltip `Continue with Discord`. Small uses 16px gutters, 56px top bar, 64px bottom navigation plus safe-area inset.

The center strictly ordered: prominent search filters, Live Rooms including featured room, then quieter ten-item Past Streams section. Create Room lives outside center on wide/medium layouts; no title toolbar or promotional hero pushes discovery down. wide left sidebar carries large `B`, connected-people count, Create Room, bottom account menu. wide right rail carries global statistics and an always-available Create Room launch panel; for anonymous visitors it starts full-page Discord OAuth directly rather than being replaced by a separate authentication control.

Every Home Create affordance opens one shared form. Wide/medium use a centered modal; small uses a full-screen safe-area- and keyboard-aware dialog. Both keep identical name, optional category, optional tags, optional single-line description, visibility, and conditional private-password fields, defaults, validation, Cancel/Create actions, focus trap/return, and dismiss behavior. Anonymous activation signs in first, carries only an opaque create intent, then reopens a blank dialog on Home; no draft/password crosses OAuth and creation is never automatic.

Use one normal document scroll. Wide rails—and the medium left rail—are sticky viewport-height companions without independent scroll regions; if their content cannot fit a short viewport, it rejoins document flow. Search/filters scroll normally during unfiltered discovery, but become sticky whenever a query/category/tag is active, below the small-stage top bar where applicable. Clearing all controls removes stickiness; bottom navigation remains fixed on small screens.

With a non-empty query, search/filters stay fixed while the featured Live Room, ranked Live Rooms, and Past Streams are replaced by separate uniform Active Rooms and Public Profiles result groups. Clearing the query restores the normal Home sections.

Wide and medium layouts expose searchable Category single-select and Tags multi-select comboboxes beside or below search. Small layouts use one Filters button and an accessible bottom sheet. Options are distinct values on current Active Rooms with counts; active filters remain removable chips with conditional Clear all. Category matches exactly after normalization and selected tags use AND semantics. Text results rank direct exact/prefix/substring matches before conservative fuzzy matches, which require at least three characters.

Search uses TanStack Pacer `useDebouncer`: trailing 250 ms, Enter flushes immediately, and unmount cancels pending navigation. Query/category/tags use canonical Home URL parameters so reload, sharing, and return navigation restore the view; intermediate edits replace rather than stack history entries. TanStack Router/Start owns loader cancellation and stale-result protection. Keep current results visible with localized progress and announce updated counts without moving focus.

Public Profile results are rich but bounded: Discord avatar/name, compact aggregate usage statistics, three most recent Past Streams, and top three co-users. The whole result is one link to the matched profile; its excerpts are non-interactive, missing rows collapse, and preview data is fetched in the grouped search projection rather than per-card requests.

TanStack Query owns all Home domain fetching and cache; Better Auth alone owns session state. The route blocks on and hydrates discovery/search plus visible Past Streams, while facets, statistics, and connected presence prefetch into shape-matched section skeletons. Search retains prior cached results with localized progress. Section Query failures show inline Retry without blocking unaffected content or rendering missing metrics as zero. Socket.IO patches value-only cached fields and targets invalidation when result membership may change. Realtime loss marks cached live values stale and shows “Reconnecting…”; successful reconnect invalidates/refetches active Home queries, then recomputes the grid once.

## Live Rooms layout

At wide widths, the featured rank-1 room fills the left side and spans the height of ranks 2 and 3 stacked on the right; rank 4 onward continues below in an equal-size two-column card grid. Medium widths use a full-width featured card followed by a two-column grid. Small widths use one column in rank order. With only one or two rooms, occupied cards use available area without empty placeholders. Counts/state update live, but assignment/order remain stable until reload, return navigation, search/filter context change, explicit refresh, or successful canonical refresh after realtime reconnection; ended rooms close cells without promotion. Search results use a uniform list.

During search, Active Rooms use one column of compact horizontal results with a small Preview mosaic and complete allowed room metadata/presence; small screens may stack mosaic above metadata. Direct matches precede fuzzy matches, then room ties use normal social rank. Public Profile ties use normalized display name then opaque ID, never usage popularity.

Every Live Room card includes a one-to-four-tile Stream Preview mosaic. More than four Streams use the four freshest previews; public previews are unblurred and private previews blurred. The featured room gives this mosaic more area beside complete room metadata, presence, state, and action. Rooms without Streams use real presence/state/metadata rather than decorative placeholder imagery.

Each Live Room card is one accessible link target: clicking or activating anywhere navigates to that room's pre-admission page. Category, tag, and state chips inside it are descriptive rather than nested controls. The destination completes authentication/admission and an explicit Join before any admitted room layout, peer state, chat, or media is shown.

## Past Streams layout

The ten recent Past Streams use a compact grid of metadata blocks: one column on mobile and two on desktop. Each block shows name, visibility, optional category/tags, and a single baseline of participation/Stream summary, ended time, and an Open action linking to the summary. A public Past Stream with an archived capture uses its real thumbnail; a private Past Stream with a non-zero Stream count uses a CSS-only blurred placeholder; all other cases use no media block. The blocks use no fake thumbnail, carousel, pagination, or table styling.

## Empty discovery

When no rooms are live outside search/filter results, replace the featured/list area with a generous but restrained text-led invitation: “The clubhouse is quiet,” one concise explanation of public versus private rooms, and a primary Create Room action. Use no illustration, fake room, onboarding steps, or decorative animation. Keep available Past Streams directly below; if none exist, add one short first-community cue.

## Admitted Stream Room shell

Desktop uses a fixed-viewport media workspace: a 72px icon application rail, compact two-line room header, dominant dark media canvas, integrated control shelf, and—at 1280px and above—a persistent 360px Chat/People/Activity dock. At 768–1279px, keep the app rail but open companions as a non-modal right workspace drawer: no dimmer, focus trap, media pause, or grid reflow. Give it explicit Close and Escape behavior with focus return; keep uncovered tile controls operable and scroll a keyboard-focused mosaic control clear of the drawer. Header and shelf stay reachable; the mosaic and each companion may scroll within bounded regions.

The header shows Back/Home, name, privacy/Full/live state, Host Settings, category/tags, current Host, member/Stream counts, and persistent lifetime countdown. The control shelf—not a floating conferencing pill—always owns the viewer's single stateful own-Stream slot, compatibility state, and Leave. That slot progresses Start Stream → `Starting…` with Cancel → Stop Stream; cancellation/failure returns to Start with inline guidance and no dialog. Mute/Unmute, Stop Watching, connection state, and Fullscreen always stay on the watched Streamer's tile. Host moderation remains contextual in People and tile menus.

The media canvas uses the midnight surface in both themes while surrounding chrome honors the selected theme. Stream media is contained without cropping. Tile order is You, initial current Host when different, then continuous join order; new members append and state/Host changes do not reorder. Selecting Watch replaces that member's Preview with the single live subscription and gives that tile layout precedence. On desktop/medium, the watched tile becomes a full-width stage in the mosaic's first row and the uniform remaining tiles flow beneath it row-major in unchanged order. The stage never fills the canvas: cap its media so the stage, its one-row footer, and the top of the next tile row stay visible without scrolling—the viewer must be able to see there is another Stream to switch to—and letterbox the 16:9 media into the midnight ground rather than cropping it. Keep each normal cell at least 240px wide with a 16:9 visual region plus its footer, and scroll the bounded mosaic before shrinking further. Selecting another stops the former watch first. Every watch starts muted. A persistent footer sits below—not over—the watched media and keeps Streamer identity/status, connection/retry, Mute/Unmute, Stop Watching, and native Fullscreen visible to touch, keyboard, and pointer users. Use one row when it fits, which a full-width stage always does; at narrow widths, use two rows with identity/watcher/connection state above media actions—never horizontal scrolling or More-menu overflow.

Before subscription, keep the thumbnail itself non-interactive and place Streamer identity, Live/preview freshness, watcher stack/count, explicit Watch, and compact Report/authorized-Host menu in a persistent footer below it. Own sharing appears as a muted browser-local Preview in the viewer's own tile, but own Start/Stop controls remain only in the shelf. Render each non-streamer as a real-avatar presence tile with name and Host/You/reconnecting/compatibility state plus the same contextual menu; never use a camera-off video treatment. Non-streamers remain visible by default; a room-session checkbox hides only their mosaic tiles for that viewer. With no Streams, retain member tiles plus a quiet `No one is sharing yet` prompt pointing compatible viewers to the bottom-bar Stream action.

The tile status line is one fragment per state, each in its own semantic family: Host in the host colour, Live and Watching in Live with a leading dot so hue is never the only carrier, Reconnecting and a stopped own capture in warning, a failed compatibility gate and an exhausted watch in danger, and identity plus preview freshness muted. A role never recolours the whole line. The on-media chip follows the same rule: Live for `Screen up`, warning while connecting, danger once the retries are spent.

Tile controls use three weights, not one. Watch and Stop Watching carry the cobalt fill — entering and leaving a watch are the same decision and must be equally findable. Mute/Unmute and Fullscreen are quiet bordered controls. The Report/Host menu trigger is quieter still: permanently visible and never hover-only, but never competing with the action a viewer came to the tile for. A Watch that cannot run stays focusable with `aria-disabled` and prints the reason beneath it, because four different conditions block it and the grey alone cannot say which.

The mosaic announces the watch lifecycle in one polite live region: connecting with its bounded attempt count, connected and muted, exhausted with the recovery copy, and stopped. The promotion to stage is the surface's one authored moment — tiles translate from where they were and the promoted tile's media grows out of the preview's footprint, so the tile you picked is visibly the tile that grew. Reduced motion removes all of it and leaves the state change immediate.

The right dock opens to Chat, can collapse to an icon rail, and preserves room-session tab/draft/scroll state. People orders Host, You, active streamers, then continuous join order. Activity remains distinct from Chat. Tile/member menus keep Report and authorized Host actions reachable without hover; Header Settings opens the responsive Metadata/Privacy/Bans dialog.

Chat follows the latest only while already at the bottom; hidden/scrolled Chat preserves position and shows unread plus New messages. Local Pending bubbles canonicalize on server acknowledgement or remain failed with Retry/Discard. Named typing presence sits above the composer and never enters history. Activity follows the same anchored-new-event pattern but remains visually distinct. Stream reports stop only the reporter's current watch after submission.

## Navigation

Home and other non-room small screens use the labeled Home/Create/Profile bottom navigation. An admitted room instead uses a contextual safe-area room bar for Stream, Chat, People, Activity, and Leave/More, with Back/Home in the room header. The desktop room uses the 72px icon app rail at all widths. Platform Admin access remains explicit only for authorized Accounts.

## Mobile live room

The mobile header shows Back, truncated name, privacy, and countdown; Details opens Host/category/tags/count/settings. With no watch, use a two-column overview. A watched Stream becomes the primary stage while remaining tiles use a horizontal strip. Chat/People/Activity/Details open at explicit 55% and 90% sheet heights with labeled Expand/Collapse and focus return. The mobile room bar carries no Stream control: mobile cannot create a Stream, and a permanently disabled slot spends a fifth of the only mobile action surface on a control that explains nothing.

Compatibility failure uses an inline chat-only banner, not a blocking modal. Reconnect grace closes media and requires explicit Watch/Start again. Forced departure replaces the admitted shell with same-URL pre-admission; room end transitions in place to the Past Stream summary.

## Motion

Use `cubic-bezier(0.2, 0.8, 0.2, 1)`: 120ms control/color feedback, 180ms menus/popovers/sheets, and 240ms layout/state transitions, with no bounce. Only the Live indicator may use a subtle opacity pulse. Reduced motion removes transforms/pulses and makes state changes immediate while preserving visible confirmation.

