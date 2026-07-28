# PLAN: Finish implementing the Claude Design into the codebase

Source of truth for the visual language: `docs/design/Home Uplift.dc.html` (project
"Greenhouse Homepage UI redesign"), with `docs/design/_ds/nocturne-b11143e3-fb4f-4bff-8152-e5bd69e2e093/styles.css`
as the token bundle.

Scope already delivered: t2 (Home surface), t3 (light theme, anonymous visitor,
connection states), and the t4 **4a "Rail Spotlight"** room shell. This plan covers
everything still between the codebase and the design.

## Binding constraint: ADRs outrank the design file

`docs/adr/0100`–`0104` already decide the admitted-room architecture. The design file
is a visual proposal drawn before those were consulted, and 4a contradicts them in
places. **Where the two disagree, the ADR wins** unless a new ADR supersedes it.

**This applies to the Home ADRs (`0079`–`0099`) too, not only the room ones.** The
first version of this plan audited `0100`–`0104` and skipped the Home range, which is
how Phase 1 item 1 shipped in contradiction of `0084` before being reverted (below).
Audit the governing ADRs for *every* surface a phase touches, not just the phase's
headline subsystem.

### Home audit, 2026-07-28

Phase 1 items were checked against `0079`–`0099` after the fact. Results:

- **`0084` vs item 1 (preview overflow) — conflict, item withdrawn.** See Phase 1.
- **`0098` vs items 2–3 (connection states) — conflict, ADR amended.** `0098` said to
  remove the stale status on recovery; the shipped `recovered` state replaces it with a
  1.2s confirmation. `0098` also said the status sits "beside the search/presence
  utility" while it renders as a viewport-pinned bar. Both are now recorded in
  `0098`'s `Amended:` line and Decision text.
- **`0083` vs item 4 (heading case) — no action.** `0083` writes "Active Rooms"/"Public
  Profiles" in title case, but `0079` writes the same pair lowercase. The ADRs disagree
  with each other, so neither is a literal string mandate.
- **`0093`, `0094`, `0079`, `0090` vs items 5–7 — clean.**
- **`0096` type scale — standing debt, predates this work.** `0096` fixes the scale at
  13/14/16/18/24/30/36px with a 13px floor. `src/styles/app.css` already ships 12.5px
  (×8), 12px (×4), 11.5px, 11px (×5) and 10px from the t2/t3 import. Not a Phase 1
  regression and not fixed here; it needs its own decision — bring the CSS to the ADR,
  or amend `0096` to the scale the design actually uses.

**Resolved 2026-07-28 by [`docs/adr/0107-room-visual-language.md`](docs/adr/0107-room-visual-language.md).**
All five conflicts below resolve in the ADR's favour; 4a is adopted as visual language
only. Read `0107` before writing room-page code — the table is kept for provenance.

| # | Design 4a says | ADR says | Proposed resolution |
|---|---|---|---|
| C1 | Fixed 320px companion rail | `0100`: 360px dock at ≥1280px, workspace drawer at 768–1279px | Follow ADR. Take the design's *styling* at 360px. |
| C2 | Spotlight tile above a thumbnail strip on desktop | `0101`: watched tile enlarges **in place** to a 2×2 span; strip layout is the mobile rule in `0103` | Follow ADR. The design's spotlight composition becomes the <768px presentation. |
| C3 | Tiles carry name + status only | `0101`/`0102`: every tile needs a persistent footer with Watch, Mute/Unmute, Stop Watching, Fullscreen, watcher stack, Report/Host menu | Follow ADR. Safety controls are non-negotiable (`0102`: never behind hover). |
| C4 | No compatibility state shown | `0103`: persistent inline compatibility banner, `Desktop only` disabled Stream on mobile | Follow ADR; style with design tokens. |
| C5 | No `Hide non-streaming participants` control | `0101` requires it | Follow ADR. |

`0107` also closes the typeface question the same way (`0096`: Source Sans 3, not the
mockup's Inter) and records the audit-before-implementation rule above.

---

## Phase 1 — Home UI deltas (no backend work) — **shipped 2026-07-28**

Self-contained, independently shippable. Roughly one working session.

1. ~~**Preview overflow tile.**~~ **Withdrawn — contradicts ADR `0084`.** The design
   (`docs/design/Home Uplift.dc.html:449`, `:715`, `:1195`) fills the fourth cell with
   `+N more`, but `0084` decides that a room card shows the four freshest previews and
   carries overflow in the total Stream count, not in a mosaic cell — which
   `PreviewMosaic.tsx:52` already renders as `N screens shared`. This was implemented,
   caught in review against `0084`, and reverted along with its `.preview-mosaic__more`
   CSS and e2e assertions. It also never worked: `home-repository.ts:126` selects
   `LIMIT 4` previews, so `previews.length > 4` is unreachable regardless of seeding.
   Do not reinstate without superseding `0084`.

2. **Recovered connection state.** *(shipped; `0098` amended — see the audit above.)* `src/features/home/HomeConnectionStatus.tsx:1` has
   `idle | reconnecting | error | replaced | revoked`. Design 3c adds a fourth visible
   state: `Back online` / `Rooms are current again.`, host-green, self-retiring after
   1.2s.
   - Add `recovered` to `HomeConnectionState`; drive it from the realtime bridge on
     socket resubscribe; auto-clear on a timer with `prefers-reduced-motion` respected.
   - Test: extend `tests/e2e/home-reconnect.spec.ts` to assert appearance and retirement.

3. **Connection copy carries elapsed time and attempt count.** Design: `Counts are
   paused — last seen 6 seconds ago.` with an `attempt 2` badge, and `You're seeing rooms
   as they were 2 minutes ago.` Current copy states neither.
   - Requires the bridge to expose `lastEventAt` and `attempt`; both are local to the
     socket client, no server change.
   - Format coarsely (`Intl.RelativeTimeFormat`, as `expiresInLabel` already does in
     `RoomShell.tsx`) so the strip does not re-render every second.

4. **Search-state copy.** Design counter: `2 rooms and 3 people match "frame"`. Current
   `PresenceCounter` (`HomeUtilities.tsx:113`) reads `N matches` and hides the breakdown
   in a visually-hidden status line. Move the breakdown into the visible counter and
   drop the duplicated live region. Group headings become `Active rooms` /
   `Public profiles` (sentence case) per design.
   - Touches `tests/e2e/home-search.spec.ts` and `home-section-recovery.spec.ts`.
   - Sentence case kept after the audit: `0083` and `0079` disagree on casing, so
     neither fixes the string.

5. **Search placeholder.** `HomeSearch.tsx:70` → `Search rooms, tags, people`.

6. **Room card sentence copy.** Design writes `9 of 12 seats taken`, `Room is full — the
   conversation is still going.`, `Anyone can see it — joining needs the password.`
   `LiveRoomCard.tsx:32` carries the same facts as bare chips.
   - Keep the chips (they carry the `data-room-visibility` / `data-room-state` probes the
     e2e suite reads); add the sentence line beneath.

7. **Profile result stat phrasing.** `ProfileSearchResult.tsx:22` reads `N rooms ·
   N streams`; design reads `31 rooms hosted` / `88 screens shared`.

**Exit criteria:** `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration` clean;
`pnpm test:e2e` shows no failures beyond the known baseline (below).

**Result, 2026-07-28:** items 2–7 shipped, item 1 withdrawn. Typecheck, unit, and
integration clean. `pnpm test:e2e` — 69 passed / 5 failed, and all 5 failures are the
documented baseline below. Two further specs failed once and passed on retry:
`home-section-recovery.spec.ts:159` (`_serverFn` hash mismatch race) and
`profile-theme.spec.ts:105`.

---

## Phase 2 — Room description blurb — **blocked: contradicts ADR `0060`**

`0060` decides that Create Room takes a name, an optional category, and up to five
optional tags, and states plainly: *"V1 provides no long-form room description or
predefined taxonomy."* Its consequence gives the reason — *"Avoiding a description field
keeps a larger persistent, searchable, and moderatable content surface out of V1."* That
is exactly the question step 5 below asks, already answered.

The cost is real and not hypothetical: `0033` indexes the Home page, so the blurb would
be a persistent, anonymous-readable, search-indexed, user-authored text surface behind
only best-effort moderation (`0025`) and report-driven enforcement (`0008`). `0045` would
also have to extend Host settings to cover it.

Note too that the design's line — `Two screens up — rewriting the auth flow. Coding
· #typescript` — is half derived and half authored, and the derived half already ships:
`N screens shared` in the mosaic summary plus the category/tag chips at
`LiveRoomCard.tsx:44`. Only the authored clause is missing, and that clause is precisely
what `0060` refused.

**Recommendation: withdraw the phase.** Building it requires superseding `0060` with a
new ADR that accepts the moderation surface; do not add the column under the existing
one. The steps below are kept for whoever makes that call.

The design's featured card and three-up cards carry a one-line blurb (`Two screens up —
rewriting the auth flow.`). No column backs it.

1. Migration `0011_room_description.sql` — `room.description text`, nullable, length-capped
   by a check constraint (240 chars matches the design's line budget).
2. `src/server/db/schema/rooms.ts`, `src/server/home/home-repository.ts` projection, and
   `ActiveRoomSummary` in `src/features/home/home-types.ts`.
3. `src/features/home/CreateRoomDialog.tsx` — optional field, plain text, same validation
   shape as the name field.
4. Render in `LiveRoomCard` (featured and grid) and `RoomSearchResult`.
5. Content policy: the blurb is user-authored text on an anonymous-readable surface. It
   falls under ADR `0018` (general-audience content policy) and ADR `0026` (English only) —
   confirm no new moderation surface is needed, or note the gap.

**Why separate from Phase 1:** it is the only Home-surface item requiring a migration, so
it should not block the copy work.

---

## Phase 3 — Room roster projection

Everything in Phases 4–6 depends on the room knowing *who is in it*. Today
`RoomProjectionSnapshot` (`src/server/rooms/room-projection.ts:19`) carries only
`memberCount`, `streamCount`, and `self` — which is why `RoomSeatStrip` renders anonymous
pips instead of member tiles.

1. Extend `RoomProjectionSnapshot` with a roster: per member `membershipId`, `accountId`,
   `displayName`, `avatarUrl`, `role`, `joinedAt`, `streamId | null`.
2. Order per ADR `0101`: viewer first (`You`), then current Host, then remaining members by
   continuous join time with a stable identity tie-breaker. Put the ordering in a pure
   function with unit tests.
   - **Correction from the audit:** the mosaic and People do *not* share one rule. `0101`
     orders the mosaic viewer → Host → join time; `0102` orders People Host → viewer →
     active streamers → join time. Both are implemented as separate pure functions in
     `src/server/rooms/room-roster.ts` (`orderRoomRoster`, `orderRoomPeople`).
   - `0101` also freezes tile order: host transfer and stream-state changes must not
     reorder existing tiles, so a mounted mosaic appends rather than re-sorting. That is
     a client obligation once Phase 3 step 4 lands; it does not bind the server order.
3. Private-room visibility: check ADR `0007` (private room history visibility) and `0003`
   (private room discovery) before exposing names. Roster is for **admitted** members only;
   the pre-admission projection must not gain it.
4. Realtime: member join/leave/stream-start/stream-stop already flow through
   `src/server/realtime/home-events.ts` for Home. Room-scoped events need their own channel
   — ADR `0030` says the realtime protocol is internal, so the shape is ours to choose;
   mirror the existing `HomeRealtimeEvent` discriminated-union + `normalize…` validator
   pattern rather than inventing a second style.
5. Replace `RoomSeatStrip` with a real member mosaic (`RoomShell.tsx:74`). Keep the seat
   strip for the pre-admission boundary, where a roster must not be exposed.

**Exit criteria:** admitted room renders one tile per member with real identity; no tile
claims media. Integration test covering roster ordering and private-room exclusion.

**Status, 2026-07-28:** steps 1, 2, 3, and 5 are done and the exit criteria are met.
`RoomProjectionSnapshot` and `AdmittedRoom` carry a roster; the SQL returns it only when
the viewer holds a current membership, and `projectDisplacedRoom` strips it explicitly.
`RoomMemberMosaic` replaces `RoomSeatStrip` inside the room; the strip stays on
pre-admission, where `0003` forbids a roster. Covered by `tests/unit/room-roster.test.ts`
and `tests/integration/room-roster.test.ts` (ordering per viewer, identity and stream
state, public and private pre-admission exclusion, displacement, departure).

**Step 4 (room-scoped realtime channel) is not started.** `src/server/realtime/` has
`connection-registry.ts` and `home-events.ts` only, so this is greenfield: server event
union, socket room fan-out, client bridge, and normalizers. Until it lands the mosaic is
correct on load and stale afterwards. It gates nothing in Phase 3 but should land before
Phase 4 leans on live tile state.

---

## Phase 4 — Stream lifecycle UI

The data model is already there: `stream` (`src/server/db/schema/streams.ts:14`) enforces one
active stream per membership, and `stream_subscription`
(`src/server/db/schema/subscriptions.ts:12`) enforces one active watch per viewer — exactly
ADR `0101`'s single-watch rule. `SubscriptionService` exists. What is missing is UI and
signaling.

1. **Control shelf** below the canvas (ADR `0100`): the viewer's single stateful own-stream
   slot — `Start Stream` → `Starting…` + Cancel → `Stop Stream` — plus compatibility state
   and `Leave`. Design 4a's bottom bar is this shelf; take its styling.
2. **Tile footers** (ADR `0101`/`0102`): identity, Live/preview freshness, watcher
   stack + count, explicit `Watch`, and a compact Report/Host menu. On a watched tile:
   `Stop Watching`, Mute/Unmute, Fullscreen, connection/retry state. Two rows at narrow
   widths, never horizontal scroll, never a More menu.
3. **Watch flow**: activating `Watch` stops the existing subscription, restores the former
   tile's preview, then connects. Failure does not resume the previous watch. Every watch
   starts muted.
4. **Compatibility gate** (ADR `0103`): persistent inline banner, Start/Watch disabled with
   the reason, `Desktop only` on mobile.
5. **Reconnect** (ADR `0103`): freeze presentation, `Reconnecting` with the 45-second grace,
   close peer media immediately, require explicit re-Watch after reclaim.

Media transport itself is ADR `0104` — native `RTCPeerConnection`, signaling over the
existing Socket.IO connection, public STUN, no TURN. **This is the single largest piece of
remaining work in the repository and should be planned separately from the design import.**
The design contributes styling to it and nothing else.

---

## Phase 5 — Companion dock: Chat, People, Activity

ADR `0102` specifies this in full. Chat has no persistence layer yet: `chat_mute`
(`src/server/db/schema/chat-mutes.ts:4`) exists from ADR `0019`, but there is no message table.

1. Migration: `message` — id, room_id, membership_id, body (500-char check), created_at;
   indexed for the 50-message first-admission backfill ADR `0102` requires.
2. Dock shell with Chat/People/Activity tabs, per-tab room-session scroll state, unread
   badges on Chat and Activity, member count on People. 360px at ≥1280px, workspace drawer
   at 768–1279px, bottom sheets below 768px (ADR `0103`).
3. Chat: pending bubble → canonical replacement on ack, failed bubble with Retry/Discard,
   mutation identity to prevent duplicates, Enter/Shift+Enter, mobile Send button,
   character counter near the limit.
4. Chat mute wiring — the ADR `0019` preference exists and must hide history and realtime
   messages for the muting viewer only, with no event emitted.
5. Typing presence: throttled to one refresh per two seconds via TanStack Pacer
   `useThrottler`, five-second server expiry, never persisted.
6. People: ordering per ADR `0102`; rows expose the same member/Host actions as tile menus.
7. Activity: canonical events only, empty on admission, `New activity` cue when scrolled up.

---

## Phase 6 — Room end, moderation, and settings surfaces

Design 4a shows the `expires in 4h 12m` countdown; `expiresInLabel` (`RoomShell.tsx:99`)
already computes it. Remaining per ADR `0103`:

- 30/10/1-minute warnings as countdown emphasis plus canonical Activity events.
- Expiry transitions in place at the stable URL to the noindex Past Stream summary
  (`PastStreamSummary.tsx` exists and is where this lands).
- Header Settings dialog (Metadata, Privacy, Bans) for the Host — ADR `0102`.
- Structured report dialog — ADR `0008`.

---

## Phase 7 — Typography

**Already decided by ADR `0096`; this is a confirmation, not an open choice.** `0096`:
*"Self-host Source Sans 3 variable WOFF2 assets; do not depend on a third-party font
request. Use Source Sans 3 for display, UI, statistics, and body copy, with a system
sans fallback."* The design specifies Inter throughout; the ADR wins, so the app keeps
the already-vendored `public/fonts/source-sans-3-latin.woff2` and Inter is not
introduced. Phase 7's remaining work is verification only: confirm nothing has crept in
a third-party font request, and confirm no second family is loaded.

The live open question in this area is not the family but the **scale** — see the
`0096` type-scale divergence recorded in the Home audit above.

---

## Testing

Layered per ADR `0106`. Every phase lands with its tests in the same change.

- `pnpm typecheck`
- `pnpm test:unit` — pure logic: roster ordering, relative-time formatting, event normalizers
- `pnpm test:integration` — repository and projection behavior against a real schema
- `pnpm test:smoke`
- `pnpm test:e2e` — run with `set -a; . ./.env; set +a` so the server picks up `DATABASE_URL`

`tests/helpers/test-environment.ts` provisions a per-worker Postgres schema and Valkey
prefix; tests call `migrateAuthDatabase(pool, schema)` themselves. No global migration step.

### Known baseline failures (present on `main`, unrelated to this work)

Do not treat these as regressions. Re-establish the baseline by stashing the working tree
and running the suite on `HEAD` before diagnosing any new failure.

- `tests/e2e/create-and-open-room.spec.ts:111`
- `tests/e2e/create-and-open-room.spec.ts:321`
- `tests/e2e/profile-responsive.spec.ts:183`
- `tests/e2e/profile-responsive.spec.ts:202`
- `tests/e2e/profile-responsive.spec.ts:226`
- `tests/e2e/root-theme.spec.ts:35` — order-dependent: this spec uses the bare Playwright
  fixture, so it fails whenever the default schema is unmigrated

---

## Sequencing

Phases 1 and 2 are independent of everything else and can ship immediately. Phase 3 gates
4, 5, and 6. Phase 7 is a one-line decision that should be made before any further CSS work.

The honest summary: Phase 1 is an afternoon, Phase 2 is a day, and Phases 3–6 are the room
product — largely unbuilt, fully specified by ADRs `0100`–`0104`, and only incidentally a
design-import task.
