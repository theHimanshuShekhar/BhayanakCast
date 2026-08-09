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
   `DESIGN.md:76`–`98` is the room's normative description; `PRODUCT.md:80`, `:89`,
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

An assumption worth stating: `DESIGN.md:92`'s "the desktop room uses the 72px icon app
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

## Current status

The Room implementation and its focused proof matrix are complete in PR #29. The former
gap IDs A4–I1 are covered by the responsive shell, header, mosaic, Host moderation, Chat,
media recovery, projection, and route-state suites under `tests/e2e/`, with transactional
contracts under `tests/integration/`.

Completed implementation tickets:

- #11–#17: Room companions, header, mosaic, member actions, kick, Host transfer, and
  Host-stopped Streams.
- #18–#24: Chat safety, media recovery, stable route states, Account deletion and
  scheduled retention, Platform Admin reports, sanctions, and room termination.
- #25: single-node deployment, backup, restore, exposure, and recovery tooling. Its
  infrastructure-dependent evidence remains an operator responsibility.

## Remaining launch qualification

- #26 — **done** (2026-08-05). `pnpm qualify:journey` runs the matrix with retries disabled
  and writes ignored local evidence under `test-results/`: 111 tests, no retries, three
  viewport stages, screenshots and axe scans, and browser output classified so an
  unrecognised error or a hydration mismatch fails the gate.
- #27 — **done** (2026-08-05). A 900-second 25-Room/250-Account capacity run passed and was
  reproduced independently on a second seed. The real-network 99% criterion was rescoped to
  a post-launch PostHog metric; ADR 0013 records that and the accepted risk.
- #28 — **closed without measurement** (2026-08-05). ADR 0013 was amended to withdraw the
  90% cohort threshold as a V1 gate: a recruited cohort with consent, a separate observer,
  and per-session scoring is disproportionate for a hobby project. The protocol and its
  computed acceptance are retained as post-V1 in `docs/operations/usability-qualification.md`
  and were not weakened to make them easier to pass.
- #30 — open. Home streams its statistics section into a hydration mismatch; quarantined by
  component name in the journey matrix so any other component's mismatch still fails.

## Verification

Layered per ADR `0106`:

- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:smoke`
- `pnpm test:e2e`

`tests/helpers/test-environment.ts` provisions a per-worker PostgreSQL schema and Valkey
prefix. Hydration-sensitive Home interactions use `gotoHydrated` from
`tests/e2e/fixtures.ts`, so server-rendered controls cannot lose interactions before their
React handlers are ready.

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
