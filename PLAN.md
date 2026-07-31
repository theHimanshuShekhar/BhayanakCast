# PLAN: Complete the Room page

Scope: the three states served at `/rooms/$roomId` — **pre-admission**, **admitted**,
**Past Stream summary** — from the state verified on 2026-07-30 to the state the ADRs
and `docs/design/` describe. The previous plan (Home uplift t2/t3 plus room Phases 1–7)
is delivered; its record lives in git history and, where it changed a decision, in the
ADRs themselves.

## Sources of truth, in precedence order

1. **`docs/adr/`** — `0100` (room shell), `0101` (single-watch mosaic), `0102`
   (companions and chat), `0103` (responsive controls and recovery), `0104` (WebRTC
   transport), plus the room-behaviour ADRs `0009`, `0019`, `0032`, `0035`, `0039`,
   `0047`, `0051`, `0055`–`0059`, `0063`, `0066`–`0072`, `0075`, `0077`.
2. **`PRODUCT.md` / `DESIGN.md` / `CONTEXT.md`** — the same decisions in prose.
   `DESIGN.md:74`–`96` is the room's normative description; `PRODUCT.md:80`, `:89`,
   `:108` are its behavioural clauses.
3. **`docs/design/Home Uplift.dc.html`** — option **4a** (`:54`, admitted wide; `:200`,
   admitted 390px) and option **4b** (`:150`, pre-admission and Past Stream). Options
   4c/4d ("Stage Immersive", `:258`, `:316`) are the rejected direction — do not build
   from them. Token bundle:
   `docs/design/_ds/nocturne-b11143e3-fb4f-4bff-8152-e5bd69e2e093/styles.css`.

**`0107` already adjudicated design-vs-ADR for this surface.** The design is adopted as
visual language and for nothing structural; the five known conflicts (rail width, watched
emphasis, tile footers, compatibility state, hide-non-streaming) are closed in the ADR's
favour. Read `0107` before touching room code. Two further design elements have no ADR
behind them and are **not** to be built: 4a's mic and camera buttons (`:111`, `:112`) and
its Raise-hand button (`:114`). This product shares screens; ADR `0002` bounds V1 media
to screen capture with picker audio (`0068`), there is no webcam and no hand-raise
concept anywhere in `PRODUCT.md`. 4a's floating control pill is likewise rejected by
`0100` ("structural surface, not floating conferencing pill") — take its button styling,
not its placement.

An assumption worth stating: `DESIGN.md:90`'s "the desktop room uses the 72px icon app
rail at all widths" means all *desktop* widths. Below 768px `0103` puts Back/Home in the
room header and one room control bar at the bottom, and 4a's 390px mock (`:203`) draws no
rail. Build no rail below 768px.

---

## What is already built (verified 2026-07-30)

Working and ADR-conformant, not to be redone:

- **Projections.** `room-projection.ts:49`/`:55`/`:64` give pre-admission, admitted and
  Past Stream shapes; the roster reaches only an admitted viewer, and
  `projectDisplacedRoom` (`:85`) strips it explicitly for `0003`.
- **Roster ordering.** `room-roster.ts` — `orderRoomRoster` (mosaic, `0101`) and
  `orderRoomPeople` (People, `0102`) as separate pure functions.
- **Media.** `useRoomMedia.ts` holds one `RTCPeerConnection` per directed subscription,
  viewer-offers; `subscription-service.ts` authorizes every relayed frame; retries run
  through a Pacer `AsyncRetryer` bounded at four attempts (`0077`).
- **Previews.** `useStreamPreview.ts` + `preview-service.ts` + `preview-image.ts` —
  30s capture, 120s throttled upload, 110s/100KB server window, private rooms capped at
  64px wide in the *stored bytes* (`0035`).
- **Chat and Activity.** `chat-service.ts` (50-message backfill, 500-char limit,
  SQL-level mute filtering), `RoomCompanionDock` tabs with per-tab room-session scroll,
  optimistic pending/failed bubbles keyed by mutation id, `useThrottler` typing.
- **Lifecycle.** 30/10/1-minute `room-warning` Activity events; in-place expiry to
  `PastStreamSummary` at the stable URL; `noindex` (`routes/rooms/$roomId.tsx:17`).
- **Dialogs.** `RoomSettingsDialog` (Metadata/Privacy/Bans over `updateRoom`/`listBans`),
  `RoomReportDialog` (`0008`, stops the reporter's own subscription),
  `MembershipConsequencesDialog` (`0069`).
- **Shelf.** `RoomControlShelf` is the single stateful own-stream slot
  (Start → `Starting…`+Cancel → Stop) plus Leave.

---

## Gap register

| # | Gap | Governing | Today |
|---|-----|-----------|-------|
| A1 | Room rail shows the anonymous sign-in door to signed-in members | — (bug) | `RoomShell` takes `session` but no caller passes it: `RoomAdmittedBoundary.tsx:102`, `RoomPreAdmission.tsx:74`, `PastStreamSummary.tsx:12` |
| A2 | Global bottom nav and room bar both render below 768px | `0103`, `DESIGN.md:90` | `HomeNavigation` always renders `.home-bottom-navigation`; `.room-mobile-bar` is `position: fixed` (`app.css:4237`) |
| A3 | Room is a document-scrolling page, not a fixed-viewport workspace | `0100`, `DESIGN.md:76` | `.room-boundary` is a padded column; dock/panel use `position: sticky` (`app.css:3970`, `:4282`) |
| A4 | Dock is a persistent 320px column at 768–1279px | `0100`, `0103`, `0107` | `app.css:3961` `minmax(0,1fr) 20rem`; drawer with Close/Escape/focus-return does not exist |
| A5 | Media canvas follows the selected theme | `0100`, `DESIGN.md:80` | `.room-stage__canvas` (`app.css:3666`) is built from `--rail`/`--action-soft` |
| B1 | Header is not the two-line composition; no Back/Home, no privacy/Full/live state, no current Host | `0100`, `DESIGN.md:78` | `RoomHeader` (`RoomShell.tsx:25`) shows eyebrow `Host`/`Member`; Back lives in the shelf (`RoomControlShelf.tsx:47`) |
| B2 | Only the 1-minute warning changes the countdown | `0103` | `data-countdown` is `urgent`/`normal` only (`RoomAdmittedBoundary.tsx:120`) |
| B3 | No compact mobile header, no labeled Details sheet | `0103`, `DESIGN.md:94` | absent |
| C1 | The 2×2 in-place span applies at every width | `0101`, `0103`, `0107` | `app.css:3989` is unconditional; no two-column overview, no stage-plus-strip below 768px |
| C2 | Previews are cropped | `0101`, `DESIGN.md:80` | `object-fit: cover` (`app.css:3766`) |
| C3 | Mosaic grows the document instead of scrolling inside bounds | `0100` | depends on A3 |
| C4 | Watcher stack has no accessible label naming visible watchers | `0101` | avatars `aria-hidden`, text is only the total (`RoomMemberMosaic.tsx:262`) |
| C5 | Presence tiles carry no reconnecting/compatibility state | `0101`, `0102` | state line is Host/You/Live/freshness only (`RoomMemberMosaic.tsx:146`) |
| D1 | Kick does not exist | `0009` | no server method, no server fn, no UI |
| D2 | Host transfer does not exist | `0056` | ditto |
| D3 | "Host tools" bans instantly, unconfirmed | `0102`, `0057` | `RoomAdmittedBoundary.tsx:73` → `RoomMemberMosaic.tsx:216` |
| D4 | Host cannot stop another member's stream from the UI | `0058`, `0102` | server side is **complete** — `stream-service.ts:96` supports the Host path and `stopStream` (`room-queries.ts:186`) already takes a `streamId`; only the UI is missing |
| D6 | `stream-stopped` Activity credits the actor, not the stream's owner | `0102` | `room-queries.ts:199` passes `session.displayName`, so a Host stopping another member's stream reads as the Host's own stream ending |
| D7 | `member-removed` and `host-transferred` have labels but no emitter | `0009`, `0056` | both are in the event union (`room-events.ts:46`) and labeled (`RoomCompanionDock.tsx:392`, `:395`); nothing in `src/server/` publishes either |
| D5 | Report/Host actions are loose buttons, not a compact menu | `0101`, `0102` | two bare buttons per tile |
| E1 | Chat has no bottom-anchoring and no `New messages` action | `0102`, `PRODUCT.md:89` | badge only while the tab is hidden |
| E2 | No per-message menu → no message Report, no chat Mute from the room | `0102`, `0019` | absent; mute is profile-only |
| E3 | Character counter always visible | `0102` | unconditional in the composer |
| E4 | Typing collapses 3+ typists to "Several people are typing…" | `0102` | `typingLabel` in `RoomCompanionDock` |
| E5 | People rows have no avatar and no reconnecting/compatibility/capability state | `0102` | name + Host/You/Streaming only |
| E6 | Composer stays live while the connection is reconnecting or lost | `0103` | dock never reads `realtime.connection` |
| E7 | Sheets: no Escape, no focus return; tabs are not a real tablist | `0103`, `0102` | `setSheet` toggles state and nothing else |
| F1 | Compatibility banner has no `Retry compatibility` | `0103` | `supported` is computed once (`useRoomMedia.ts:67`) so it cannot be re-tested |
| F2 | Mobile `Desktop only` has no help affordance | `0103` | `data-disabled-reason` attribute only |
| F3 | Reconnecting never shows the remaining 45-second grace | `0103` | `RECONNECT_GRACE_MS` is a bare timer (`useRoomRealtime.ts:167`) |
| G1 | Pre-admission is a header plus a seat strip, not 4b's gate | design `:150`, `PRODUCT.md:54` | no chips/hero/stat-pair/presence line composition |
| H1 | Past Stream summary carries its facts in the header, not 4b's stat pair | design `:181` | cosmetic only; behaviour is correct |
| I1 | **No e2e spec covers the admitted room** | `0103`, `0106`, `0107` | `tests/e2e/` has `create-and-open-room` and `room-oauth-return` and nothing else |

Standing debt, carried over and still unresolved: `0096` fixes the type scale at
13/14/16/18/24/30/36px with a 13px floor, and `src/styles/app.css` ships 12.5/12/11.5/11
and 10px. Not a room regression — it needs its own decision (bring the CSS to the ADR, or
amend `0096` to the scale the design actually uses). Do not quietly widen this plan to
cover it.

---

## Phase R1 — Shell correctness

Everything else renders inside this, so it goes first. Four defects, one CSS rewrite.

1. **Session reaches the room rail (A1).** Extract `getHomeSession`
   (`routes/index.tsx:19`) into a shared server fn — `src/server/auth/session-fn.ts` is
   the natural home, and `routes/index.tsx` and `routes/profile.tsx` both switch to it.
   `routes/rooms/$roomId.tsx` loads it alongside the projection; `RoomRoute` threads it
   into all three boundaries, which pass it to `RoomShell`.
2. **One bottom bar below 768px (A2).** Give `HomeNavigation` a `variant` — or, cheaper
   and with fewer callers to touch, let `RoomShell` set `data-room-shell` on the wrapper
   (it already does) and add `.room-shell[data-room-shell="admitted"] .home-bottom-navigation { display: none }`
   inside the `max-width: 47.999rem` block. Only the admitted state suppresses it:
   pre-admission and Past Stream are ordinary pages and keep the global nav
   (`DESIGN.md:90` says "an admitted room").
3. **Fixed-viewport workspace (A3, C3).** At ≥48rem, `.room-shell` becomes
   `height: 100dvh` with `overflow: hidden`; `.room-boundary--admitted` becomes a grid
   with `grid-template-rows: auto minmax(0, 1fr)` so the header is fixed and the stage
   row owns the remaining height. `.room-stage__canvas` and `.room-mosaic` become the
   bounded scroll region (`overflow-y: auto`, `min-height: 0`); the dock gets its own.
   Drop the `position: sticky` workarounds at `app.css:3970` and `:4282`. Below 48rem the
   page keeps document scroll — `0103` describes a scrolling phone shell with a fixed
   control bar, not a locked viewport.
4. **Midnight canvas in both themes (A5).** Add explicit canvas tokens
   (`--canvas`, `--canvas-edge`, `--canvas-ink`) pinned to the midnight values from the
   nocturne bundle in *both* theme blocks, and build `.room-stage__canvas`,
   `.room-mosaic__tile` media regions and `.room-mosaic__video` from them. Chrome — rail,
   header, shelf, dock, dialogs — keeps the selected theme.

**Tests.** `tests/e2e/room-shell.spec.ts` (new): signed-in member sees their account
control in the room rail and no `Discord` sign-in door; at 390px exactly one bottom bar is
visible in an admitted room and the global nav is visible on pre-admission; at 1280px the
document does not scroll while the mosaic does. Extend `tests/e2e/root-theme.spec.ts` or
add a case asserting the canvas background is unchanged between porcelain and midnight.

**Exit:** admitted room at 1280px is a fixed viewport with two nested scroll regions; one
bottom bar at 390px; rail identity correct in all three states.

---

## Phase R2 — Room header

1. **Two lines (B1).** `RoomHeader` gains an explicit two-row structure per
   `0100`/`DESIGN.md:78`. Line 1: Back/Home link, room name (`data-room-primary-heading`
   stays — `RoomRoute` focuses it), `Public`/`Private` chip plus `Full` or live state,
   Host-only Settings. Line 2: description (already clamped), category and tags, current
   Host avatar and name, member and Stream counts, lifetime countdown. Move the Back link
   out of `RoomControlShelf.tsx:47`; Leave stays in the shelf (`0100`).
   The current Host comes off the roster — `roster.find(m => m.role === 'host')` — so no
   projection change is needed for the admitted header.
   Keep the header at two rows: the description already clamps, and the countdown must not
   be displaced into a third row.
2. **Countdown emphasis (B2).** Replace the boolean with a three-step attribute driven by
   the latest `room-warning` minutes: `data-countdown="normal" | "notice" | "urgent"`,
   where 30 and 10 get restrained emphasis and only 1 is warning-level. Put the mapping in
   a pure exported function beside `expiresInLabel` (`RoomShell.tsx:111`).
3. **Mobile header and Details sheet (B3).** Below 768px the header collapses to Back, a
   truncated name, privacy state and countdown. A labeled `Details` control opens a sheet
   carrying category/tags, current Host, member/Stream counts and (for the Host) Settings.
   Reuse the sheet mechanics from R3 step 2 rather than writing a second sheet — `Details`
   becomes a fourth sheet key alongside `chat`/`people`/`activity`. Core metadata never
   scrolls horizontally.

**Tests.** Unit: countdown-emphasis mapping (`tests/unit/room-countdown.test.ts`).
E2E in `room-shell.spec.ts`: the header is two rows at 1280px and shows the Host's name;
at 390px the header is compact and `Details` opens a sheet containing the category and
Host; Settings appears only for the Host.

---

## Phase R3 — Companions: medium drawer, sheets, accessibility

1. **Workspace drawer at 768–1279px (A4).** The dock stops being a grid column in that
   band and becomes a non-modal right drawer: no scrim, no focus trap, no media pause, and
   **no mosaic reflow** — the mosaic keeps its column count when the drawer opens. It
   needs an explicit Close, Escape dismissal, focus return to the invoking tab, and its own
   scroll. Uncovered tile controls stay usable; a keyboard-focused mosaic control must
   scroll clear of the drawer (`scrollIntoView` on focus when the drawer is open, guarded
   by `prefers-reduced-motion`). At ≥1280px the dock is the persistent **360px**
   (`22.5rem`) column it already is at that breakpoint. Delete the 320px column at
   `app.css:3961` — `0107` rejects it explicitly.
   The tab strip that invokes the drawer lives where the 1280px dock's tabs live, so the
   drawer needs a collapsed rail state carrying the unread/count badges.
2. **Sheet behaviour below 768px (E7).** Escape dismisses; dismissal and sheet switching
   return focus to the invoking room-bar or header control; `Expand`/`Collapse` move
   between the existing 55vh and 90vh heights (`app.css:4267`/`:4271`) with labels, and
   Chat expands for the on-screen keyboard. Track the invoking element in a ref in
   `RoomAdmittedBoundary` where `sheet` state already lives.
3. **Real tablist.** `.room-dock__tabs` gets `role="tablist"`, each tab
   `aria-controls`/`id`, and the panel `aria-labelledby`. Badge counts get accessible text
   (`3 unread messages`, not a bare `3`).

**Tests.** `tests/e2e/room-responsive.spec.ts` (new): at 1024px opening People does not
change the mosaic's column count, Escape closes the drawer and focus returns to the People
tab; at 390px Chat opens at ~55%, `Expand` reaches ~90%, Escape returns focus to the Chat
bar button. Unit coverage for the tab/panel wiring in `tests/unit/room-dock.test.ts`.

---

## Phase R4 — Mosaic: two emphasis models

`0107` is explicit that above and below 768px differ in emphasis model, not only in size,
and that both must be tested as distinct behaviours.

1. **≥768px — in place (already correct).** Keep the 2×2 span (`app.css:3989`); scope it
   to the ≥48rem media query so it stops applying on phones. Confirm the "scroll before a
   cell falls below 240px" rule still holds now that tiles carry footers — the grid's
   `minmax(15rem, 1fr)` is the 240px floor, and R1's bounded region is what scrolls.
2. **<768px — overview, then stage plus strip (C1).** With no active watch, a two-column
   overview. Once a watch succeeds, the watched tile becomes the primary stage and every
   remaining tile moves into a labeled horizontal strip beneath it. The strip is the one
   place horizontal scrolling is allowed — footers inside it never scroll horizontally.
   This is a DOM change, not only CSS: the strip is a different container, so
   `RoomMemberMosaic` needs a layout mode prop (`'grid' | 'stage'`) chosen from a media
   query hook, with the tile component shared between both. Tile *order* is unchanged in
   both modes (`0101`).
3. **`Hide non-streaming participants` applies to both (C6).** It already filters the
   roster before rendering (`RoomMemberMosaic.tsx:33`), so it carries into the strip for
   free — assert it rather than rebuild it.
4. **Contain, not cover (C2).** `.room-mosaic__preview` → `object-fit: contain` on the
   canvas surface, matching `.room-mosaic__video` (`app.css:3984`).
5. **Watcher-stack label (C4).** Give the stack an accessible label naming the visible
   watchers and the total — `Watched by Mira, Ken and 4 others`. Pure formatter, unit
   tested; the avatars stay `aria-hidden`, and the stack stays informational with no
   popover or focus target.
6. **Presence state completeness (C5).** The tile state line gains reconnecting and
   compatibility state. Reconnecting is per-member and the room projection does not carry
   it today — derive it from the membership realtime the room already receives rather than
   adding a column; if that proves to need a new event payload, that event is the one to
   add (`0030` makes the protocol ours), not a schema change.

**Tests.** `room-responsive.spec.ts`: at 1280px watching enlarges the tile to a 2×2 span
with its DOM position unchanged; at 390px watching moves the other tiles into the strip and
the watched tile becomes the stage; the hide-checkbox empties the strip of non-streamers.
Unit: watcher-stack label formatting.

---

## Phase R5 — Host moderation, completed

The largest functional gap: two ADR-decided capabilities have no implementation at all,
and the one that exists is wired to fire without confirmation.

1. **Kick (D1).** `MembershipService` gains `kick(hostAccountId, roomId, targetAccountId)`
   — Host-authorized, closes the target's membership interval, stops any active stream, and
   emits the same presence/stream-stop transitions as a forced leave. It creates **no** ban
   (`0009`): the target may rejoin immediately if gates allow. Reuse
   `departInTransaction` and `stopMembershipMedia` (`membership-service.ts:297`, `:340`)
   rather than writing a second departure path — a kick is a forced leave with a different
   authorizer. The target's client sees the generic forced-departure treatment `0103`
   already specifies, and Activity says `X is no longer in this room.` (the existing
   `member-removed` label, deliberately reasonless).
2. **Host transfer (D2).** `RoomService.transferHost(hostAccountId, roomId, targetAccountId)`
   — target must be a current member of the same live room; applies immediately, keeps both
   accounts in the room, preserves all streams and subscriptions, broadcasts the new Host
   state. The `host-transferred` Activity kind already exists in `activityLabel`, so the
   publisher is the missing half. No request/acceptance workflow (`0056`).
3. **Host stop stream (D4).** **Server side already works** — `StreamService.stop`
   (`stream-service.ts:96`) authorizes the Host path and `stopStream`
   (`room-queries.ts:186`) already takes an arbitrary `streamId`, so this is UI wiring
   only: put `Stop this stream` in the streaming tile's Host menu and the matching People
   row. Host stop is current-stream-only (`0058`); a later stream needs no new
   authorization step and the watcher's client requires an explicit re-Watch (`0067`).
4. **Correct the Activity attribution (D6, D7).** Three defects that only become visible
   once Hosts can act on other members, so they land with this phase:
   - `stopStream` publishes `publishActivity(roomId, 'stream-stopped', session.displayName)`
     (`room-queries.ts:199`) — the **actor**. When a Host stops someone else's stream the
     room reads that the Host stopped streaming. It must name the stream's owner;
     `StreamService.stop` already returns the owning `membershipId`.
   - Nothing publishes `member-removed`, so the kick in step 1 has a label waiting for it
     and must emit it.
   - Nothing publishes `host-transferred`, so the transfer in step 2 must emit it.
5. **One compact menu per target (D3, D5).** Replace the loose `Report` and `Host tools`
   buttons with a compact menu component used by both the tile footer and the People row —
   a single `<RoomMemberMenu>` taking the member plus the viewer's capabilities, so the two
   call sites cannot drift. It carries Report always, and for a Host: Stop stream (when
   streaming), Kick, Ban, Transfer Host. **Every destructive item confirms** with a focused
   dialog that names the target and states the consequence (`0102`); `MembershipConsequencesDialog`
   is the closest precedent to follow, not to reuse verbatim. The menu is a real menu with
   keyboard support — but it is never where a *safety* control hides: Report stays reachable
   without opening anything, per `0102`'s "never behind hover".
6. **No end-room control.** `0055` is explicit that V1 gives Hosts no room-end action.
   Do not add one; do not let "Host tools" imply one.

**Tests.** Integration (`tests/integration/room-moderation.test.ts`): kick closes the
interval, stops the stream, writes no ban row, and permits immediate rejoin; transfer moves
the role, preserves streams and subscriptions, and rejects a non-member target; non-Host
callers are rejected on all three. E2E (`tests/e2e/room-moderation.spec.ts`): two contexts,
Host kicks the member, the member's page becomes same-URL pre-admission with Join
available; ban leaves Join unavailable; transfer moves the Host chip and the settings
control to the other context; every action passes through a confirmation that can be
cancelled without effect.

---

## Phase R6 — Chat and companion completeness

1. **Anchoring and `New messages` (E1).** Chat auto-scrolls only when the reader is
   already at the bottom; otherwise it holds position and exposes a `New messages` action
   that jumps to the latest. `RoomCompanionDock` already has the bottom test (`atBottom`)
   and the Activity `New activity` cue — mirror that pattern for Chat instead of inventing
   a second one.
2. **Message menu: Report and Mute (E2).** Each message gains the compact menu with Report
   for eligible targets and persistent chat Mute (`0019`). Mute immediately hides that
   account's history and realtime messages for this viewer, emits nothing, and changes no
   other room state — the SQL filter in `chat-service.ts` and the profile mute list already
   exist, so this is a call site plus a local optimistic filter, not new persistence. A
   muted account's typing indicator is also hidden (`0102`).
3. **Counter near the limit (E3).** Show the 500-character counter only as the limit
   approaches; keep validation and error text visible at all times.
4. **Typing label (E4).** Up to two display names plus `and N others are typing`. Pure
   function, unit tested, replacing the "Several people" collapse.
5. **People rows (E5).** Add the avatar and the reconnecting/compatibility/sanction-relevant
   capability state, without exposing private enforcement reasons.
6. **Frozen mutations (E6).** While `realtime.connection !== 'live'`, disable the composer,
   the send button, and every media mutation, with the reason stated once. The banner text
   already exists in the shelf; the dock must honour the same state.

**Tests.** Unit in `tests/unit/room-dock.test.ts`: chat anchoring and the `New messages`
cue, typing label at 1/2/3/5 typists, counter threshold, composer disabled while
reconnecting. E2E: mute in one context hides the muted author's history and new messages for
that viewer only.

---

## Phase R7 — Compatibility and recovery

1. **Retryable compatibility (F1).** `supported` becomes a re-runnable probe rather than a
   one-shot `useState` initializer (`useRoomMedia.ts:67`), and the persistent inline banner
   gains `Retry compatibility` plus recovery guidance. The banner stays above the shelf and
   the room bar, non-dismissible, not a toast and not a modal (`0103`, `0107`). Chat,
   presence and previews stay usable throughout (`0059`).
2. **`Desktop only` help (F2).** The disabled mobile Stream control gets a real help
   affordance explaining the Chromium-family desktop requirement, not just a data
   attribute.
3. **Grace countdown (F3).** Surface the remaining seconds of the 45-second grace
   (`0047`) while reconnecting, coarsely formatted so the shelf does not re-render every
   second. On reclaim, refresh canonical state and restore presence/chat context with **no
   backfill**; the former watched tile returns to its preview and requires an explicit
   Watch, and the member's former stream stays stopped and requires an explicit Start —
   which `useRoomMedia` already does, so this phase asserts it rather than rebuilding it.

**Tests.** `tests/e2e/room-recovery.spec.ts` (new): with the socket forced offline, the
room freezes, states the remaining grace, and disables the composer; on reconnect the
canonical state returns with no duplicated backfill and the previously watched tile shows
its preview with a `Watch` button. Unit: the grace formatter, and `supported` re-probing.

---

## Phase R8 — Pre-admission and Past Stream surfaces

Behaviour here is already correct; this is the design's visual language applied
(`0107`), plus the composition 4b specifies.

1. **Pre-admission (G1)**, from design `:150`–`:176`: a dark hero with a decorative
   blurred backdrop — decorative only, built from tokens, **never** from real preview
   bytes (pre-admission carries no preview keys and `0003` keeps it that way); the
   `Public`/`Private` and category chips; the large room name; the explicit-join sentence
   *"Join explicitly to enter this room — opening this link doesn't join you."*; the
   member/Stream stat pair; one primary Join; and the live presence line
   *"N people are here right now"*. The seat strip (`RoomShell.tsx:85`) stays — it is the
   honest count-without-identities the design's member tiles cannot be. Keep the password
   field for private rooms and the `Full` disabled state.
2. **Past Stream (H1)**, from design `:181`–`:195`: the `Past stream` eyebrow, the muted
   name, the ended sentence with its timestamp, and the member/Stream stat pair as a pair
   rather than header facts. `Back to Home` stays; no Join control, ever (`0063`).
3. Both keep the global bottom navigation below 768px (R1 step 2) — they are not admitted
   rooms.

**Tests.** Extend `tests/e2e/create-and-open-room.spec.ts`'s existing pre-admission case
with assertions on the chips, the stat pair and the presence line; add a Past Stream case
asserting no Join control and the `noindex` meta.

---

## Phase R9 — The room's e2e suite

The gap that lets every other gap regress: **no spec covers the admitted room** (I1).
Phases R1–R8 each land their own specs above; this phase is the cross-cutting matrix
`0103` and `0107` demand and closes the layered-testing obligation in `0106`.

The fixture already supports this: `tests/e2e/fixtures.ts` gives multiple authenticated
browser contexts plus raw `sql`, so a Host and two members in one room is a normal test.

Matrix to cover, at 390px / 1024px / 1280px:

- safe-area room bar and exactly one bottom bar;
- both sheet heights, `Expand`/`Collapse` labels, focus return on dismissal and switching;
- the medium drawer: no reflow, Escape, focus return, focused mosaic control scrolls clear;
- both emphasis models: 2×2 in place above the breakpoint, stage-plus-strip below;
- chat-only compatibility: banner persists, Start/Watch disabled with the reason, chat
  works;
- reconnect reclaim and reconnect expiry;
- forced departure (kick, ban, displacement) → same-URL pre-admission;
- in-place room end → Past Stream summary at the same URL;
- short viewport and 200% zoom: header and shelf controls never become unreachable
  (`0100`'s consequences name this explicitly).

---

## Testing

Layered per `0106`; every phase lands with its tests in the same change.

- `pnpm typecheck`
- `pnpm test:unit` — pure logic: countdown emphasis, typing label, watcher-stack label,
  grace formatter, chat anchoring
- `pnpm test:integration` — kick, transfer, Host stop-stream, authorization rejections
- `pnpm test:smoke`
- `pnpm test:e2e` — run with `set -a; . ./.env; set +a` so the server picks up
  `DATABASE_URL`

`tests/helpers/test-environment.ts` provisions a per-worker Postgres schema and Valkey
prefix; tests call `migrateAuthDatabase(pool, schema)` themselves. There is no global
migration step.

### Known baseline failures (present on `main`, unrelated to this work)

Re-establish the baseline by stashing the working tree and running the suite on `HEAD`
before diagnosing any new failure.

- `tests/e2e/create-and-open-room.spec.ts:111`
- `tests/e2e/create-and-open-room.spec.ts:321`
- `tests/e2e/profile-responsive.spec.ts:183`
- `tests/e2e/profile-responsive.spec.ts:202`
- `tests/e2e/profile-responsive.spec.ts:226`
- `tests/e2e/root-theme.spec.ts:35` — order-dependent: uses the bare Playwright fixture,
  so it fails whenever the default schema is unmigrated

---

## Deliberately not in scope

Each of these is a decision already taken, recorded here so it is not reopened by a
mockup or by a passing thought:

- **Mic, camera, raise hand** (design `:111`, `:112`, `:114`) — no webcam, no hand-raise in
  V1 (`0002`, `0068`).
- **Floating control pill** — `0100` mandates a structural shelf.
- **Fixed 320px rail at all widths** — `0107` closed this.
- **Preview-overflow `+N more` cell** — contradicts `0084`; withdrawn once already.
- **Picture-in-Picture, playback mixer, multi-watch** — `0101`, `0039`.
- **Host room-end control** — `0055`.
- **Chat message deletion, timeouts, slow mode** — `0009`'s consequences.
- **Inter** — `0096` fixes Source Sans 3, already vendored and verified.
- **A room-scoped realtime channel beyond the existing union** — the room already has
  `ROOM_SOCKET_EVENT` carrying chat, activity, typing, signals and lifecycle. Add event
  *kinds* where a phase needs one (R4 step 6 may); do not add a second protocol.

## Sequencing

R1 first — R2, R3 and R4 all render inside the workspace it fixes. R5 is independent of
the layout work and can run in parallel with R2–R4 if that is useful; it is the phase with
server changes and the phase with real safety consequences, so it should not be last. R6
and R7 depend only on R1. R8 is independent throughout. R9 needs R1–R8 to assert against,
but its per-phase specs are written as those phases land, not deferred to the end.
