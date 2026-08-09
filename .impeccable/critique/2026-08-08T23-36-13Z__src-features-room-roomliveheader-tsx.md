---
target: room live header
total_score: 13
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 3
timestamp: 2026-08-08T23-36-13Z
slug: src-features-room-roomliveheader-tsx
---
Method: dual-agent (A: DesignReviewA · B: DetectEvidenceB)

Target: `src/features/room/RoomLiveHeader.tsx` + `src/styles/app.css:5278-5593`. Mode: **Operate**. Review is source-based — the admitted shell is behind Discord OAuth and no browser inspection was run.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Countdown has no visible subject (`RoomLiveHeader.tsx:119`); `Full` *replaces* `Live` (`:86`) so a full room stops affirming it is live |
| 2 | Match System / Real World | 2 | `Back / Home` (`:76`) is ADR shorthand as UI copy; SR countdown says "Room expires in 665 minutes" (`room-countdown.ts:22`); `Unavailable` (`:232`) is DB vocabulary for "the host left" |
| 3 | User Control and Freedom | 1 | `<a href="/">` (`:68`) is unguarded one-click exit from a live room mid-stream — no `useBlocker`/`beforeunload` anywhere in `src/` — while shelf Leave is confirmed. Details sheet has no outside-tap dismissal |
| 4 | Consistency and Standards | 1 | Two divergent state-chip vocabularies across the join boundary; two incompatible bottom-sheet implementations (`app.css:5501-5516` vs `4968-4978`); every control collapsed to one cobalt weight (`app.css:2060-2064`) |
| 5 | Error Prevention | 1 | Nothing guards the Back exit; the 30s poll (`:36`) can shrink the mandated 1-minute warning to ~30s; desktop omits the capacity denominator (`:114`) so `Full` arrives unannounced |
| 6 | Recognition Rather Than Recall | 1 | Second row is up to eleven unlabeled atoms in one type/colour; only `Host` is labeled (`:225`). User must recall that the cap is 10 and that `11h left` refers to the room |
| 7 | Flexibility and Efficiency | 2 | `title={room.name}` (`:79`) is the one power affordance; no equivalent for truncated description/category/tags, and Details is `display:none` ≥768px (`app.css:5315-5319`) |
| 8 | Aesthetic and Minimalist Design | 1 | 36px room name over an undifferentiated 13/14px ribbon, with a cobalt-filled `Settings` slab as the loudest interactive element on a state surface |
| 9 | Error Recovery | 1 | The only degraded state expressible is `Unavailable` (`:232`) — same muted grey as everything else, no semantic family, no explanation, no recovery |
| 10 | Help and Documentation | 1 | The 12-hour cap is never explained. ADR 0075 says there is no extension in V1; the header never says so, so a host at `30m left` hunts for a control that does not exist |
| **Total** | | **13/40** | **Poor — major rework of this surface** |

All ten heuristics apply: Operate surface with persistent state, irreversible navigation, and a hard deadline.

## Design Specificity Verdict

**LLM assessment.** Could ship unchanged in any conferencing product — with one BhayanakCast-shaped exception it then fails to honour. Strip the strings and this is the generic live-session header: back link, title, two pills, a muted metadata ribbon, counts, a timer. Nothing says *clubhouse*.

The one genuinely BhayanakCast idea — the 12-hour lifetime from ADR 0075, a hard non-extendable social deadline no conferencing product has — renders as `11h left` (`room-countdown.ts:27`) in 13px muted text at the far right of row two (`RoomLiveHeader.tsx:119`), typographically identical to `2 Streams` beside it (`app.css:5396-5401`). The product's most distinctive fact is drawn as its least distinctive element.

Worse, the header breaks from the language the same visitor saw ninety seconds earlier on Home. `LiveRoomCard.tsx:42-52` renders privacy as `.room-chip--private` (violet `--private`) and Full as `.room-chip--full` (amber `--warning`), additive, in the same chip vocabulary as category and tags. The live header invents two new pills: `.room-live-header__privacy` (`app.css:5321-5332`) is neutral grey for *both* Public and Private, and `.room-live-header__live-state` (`app.css:5334-5337`) is Live-pink for *both* Live and Full. The same two facts change colour, family, and radius when you cross the join boundary — and a room at its hard cap is painted in the Live family. Not generic: locally invented and inconsistent with the system that already existed.

The room name at `--text-page` (2.25rem = 36px, `app.css:3625-3632`, token at `:26`) inside what ADR 0100 calls a "compact two-line header" is the final tell — the discovery-page treatment carried into an Operate surface where the visitor already knows which room they are in.

**Deterministic scan.** Both required detector runs are **clean**: `detect.mjs --json src/features/room/RoomLiveHeader.tsx` and `detect.mjs --json src/features/room` each returned `[]`, exit 0, zero rules triggered. The detector caught nothing the review missed; it also confirms that none of the issues below are generic anti-patterns — they are all product-specific judgment and cascade problems no rule set catches.

**Objective token facts (Assessment B, verified).** Type scale is clean — header uses only `--text-label` 13px, `--text-meta` 14px, and the mobile `h1` at 1.125rem = 18px (`app.css:5498-5501`), all on the fixed scale. Radii conform (8px control, 12px panel, pills). Contrast passes on direct backgrounds in both themes. **One real contrast failure:** the one-minute countdown paints `--warning` `#946000` over a 14% warning wash (`app.css:5442-5448`); composited over light surface/canvas the ratio is ≈**4.45:1 / 4.18:1** — below 4.5:1 AA. I recomputed this independently and confirm it. Dark theme passes (≈8.4/9.2:1). Global `:focus-visible` (`app.css:235-238`) reaches every header control with no override. No `transition` or `animation` exists anywhere in the block.

**Visual overlays.** None. No browser visualization ran, so no overlay is available in your browser. Reason: the admitted shell requires an authenticated Discord session; the e2e suite reaches it via a seeded `authSessions` context (`tests/e2e/room-header.spec.ts:17-31`, `tests/e2e/room-shell.spec.ts:25-39`) that was out of scope for a read-only pass.

## Overall Impression

The plumbing is better than the design. Focus return, min-width truncation chains, tabular numerals, a deliberately throttled poll — someone read the brief and got the hard mechanics right. Then the surface those mechanics support was never composed: the header ranks the room's name (static, already known) above its deadline and its live state (volatile, the reason you look), invents a state vocabulary that contradicts the one on Home, and ships a mobile sheet that paints over the only bar carrying **Leave**.

Single biggest opportunity: **invert the hierarchy around volatility.** This is an Operate surface. What changes should be loud; what is fixed should be quiet.

## What's Working

1. **The focus contract on the Details sheet is done properly.** `:42` focuses Close on open; `dismissDetails` (`:28-33`) returns focus to the trigger through `requestAnimationFrame`, which survives the unmount, and does so identically for the control and Escape paths. ADR 0103:20 asks for this; most implementations return focus on the button path only.

2. **The truncation plumbing is correct all the way up.** `min-width: 0` on `.room-live-header` (`app.css:5282`), `__primary` (`:5290`) *and* the h1 (`:5297`), with the name column as `minmax(6rem, 1fr)` (`:5291`). That chain is the thing everyone forgets; it means ADR 0100's "the header stays two lines" holds for a 200-character room name. `title={room.name}` (`:79`) gives back what truncation took.

3. **Tabular numerals and a throttled poll.** `font-variant-numeric: tabular-nums` (`app.css:5400`) stops counts jittering per the brief; the 30s interval (`:36`) deliberately avoids a per-second re-render of the whole admitted shell. Small, correct, specified.

## Priority Issues

### [P0] The Details sheet covers the mobile room control bar, including Leave

**Why it matters.** `.room-details` is `position: fixed; inset: auto 0 0; z-index: 18` with opaque `background: var(--surface)` and `padding-bottom: calc(4rem + env(safe-area-inset-bottom))` (`app.css:5501-5516`). `.room-mobile-bar` — the only mobile surface carrying Stream, Chat, People, Activity and **Leave** — is `position: fixed; inset: auto 0 0; z-index: 17` (`app.css:4913-4918`). The sheet paints over it, and the reserved 4rem sits *inside* the sheet, showing blank surface where the bar was. The companion sheet solves this correctly two thousand lines away: `z-index: 16` with `padding-bottom: calc(0.75rem + var(--room-mobile-bar-height))` (`app.css:4968-4978`, token at `:4959`) — it sits *under* the bar. Details also hardcodes `4rem` instead of that token, so even the reservation is wrong.

Compounding: no outside-tap dismissal and no drag handle (`:123-144`) — two buttons are the only pointer exit. The Escape guard at `:44` checks only `event.key !== 'Escape'` and omits the `event.defaultPrevented` check that `RoomCompanionDock.tsx:189` has, so with a companion sheet already open one Escape dismisses **both**. And `openSettings('details')` (`:194-197`) does not close the sheet, leaving it mounted under the settings dialog with its document-level Escape listener live — and `RoomSettingsDialog` has no Escape handler of its own, so Escape over the modal closes the invisible sheet and yanks focus to a control under the scrim.

ADR 0103:14 makes the room bar the single reachable mobile action surface and 0103:42 puts Leave on it. A member who taps Details to check the host has silently lost Leave.

**Fix.** Drop `.room-details` to `z-index: 16` and reserve `calc(0.75rem + var(--room-mobile-bar-height))`, matching `app.css:4968-4978`. Add `event.defaultPrevented` to the guard at `:44`. Close the sheet inside `openSettings('details')`. Add backdrop-tap dismissal. Give `RoomSettingsDialog` its own Escape handling.

**Suggested command:** `/impeccable harden`

### [P1] Both state pills abandon their semantic families; `Full` is painted `Live`

**Why it matters.** `.room-live-header__privacy` (`app.css:5321-5332`) renders Public and Private identically in `--ink-muted` on a `--border` outline. `.room-live-header__live-state` (`:5334-5337`) renders Live and Full identically in `--live` pink. The value is carried by the word alone (`:83`, `:86`). DESIGN.md's colour strategy requires the semantic families to stay distinct and reserves warning for warning; ADR 0107 adopts that palette wholesale. Painting a room at its hard 10-member cap in the Live family is the opposite reading. And because `:86` is a ternary, a Full room stops saying "Live" at all — the header cannot express "live *and* full", which is the actual state. Privacy, the fact governing who can walk in, is the least emphasised thing in the header.

**Fix.** Reuse `.room-chip--public` / `--private` / `--full` from `app.css:2626-2645` instead of header-local pills, and make Full additive to Live so both facts survive. If header pill geometry must differ, change radius and height — not the colour family.

**Suggested command:** `/impeccable colorize`

### [P1] The countdown escalates *through the success family* and can under-deliver the one-minute warning

**Why it matters.** `app.css:5437-5440` colours the ten-minute state `--host` — the success/Host green used for host authority and healthy state. Because `roomCountdownState` uses `Math.ceil` (`room-countdown.ts:7-9`), that state covers 10 minutes down to 61 seconds, so **`2m left` renders in success green**. Ten minutes before a room dies, the header reassures you. Separately `setInterval(…, 30_000)` (`:36`) lags state by up to 30s, so the amber one-minute treatment can appear with ~30 seconds actually left, and `Ending now` can appear after the room has already gone. ADR 0103:38 requires a 30/10/1 escalation ladder with only the last at warning prominence — green is not a rung on it. ADR 0075 promises a one-minute warning; a 30s poll cannot guarantee one. The one-minute state also fails AA contrast in light theme (≈4.45:1, `app.css:5442-5448`).

**Fix.** Neutral-to-warning ramp: `--ink` at 30 min (already correct), a distinct pre-warning treatment at 10 min that is not `--host`, warning at 1 min. Schedule an exact-boundary timeout (or drop to 1s polling) inside the final two minutes while keeping the 30s cadence above — the cost the throttle avoids only exists over eleven idle hours. Darken the one-minute foreground or drop the wash to clear 4.5:1 on light surface and canvas.

**Suggested command:** `/impeccable colorize`

### [P1] The desktop second row is an unlabeled ribbon whose layout moves when metadata is absent

**Why it matters.** `:110-120` emits metadata, host, `7 members`, `2 Streams`, and the countdown as five siblings into `grid-template-columns: minmax(0, 1fr) auto auto auto auto` (`app.css:5342`), all at 13/14px in `--ink-muted`, separated by a uniform `0.875rem` (`:5344`). Only Host is labeled (`:225`); the countdown's subject exists solely in an `aria-label` (`:54`). Three adjacent unlabeled numbers in identical type is a scanning failure in Operate mode.

Then `RoomMetadata` **returns `null`** when a room has no description, category or tags (`:205`). With that child gone, `HostFact` takes the `minmax(0, 1fr)` column and the countdown lands in column 4 instead of 5. The most important persistent element in the header does not hold a stable position across rooms — it moves depending on whether the host bothered to add a tag.

**Fix.** Always render the metadata container (empty `<div>` rather than `null` at `:205`), or move to `grid-template-areas` so every slot is reserved. Give the countdown a visible subject — `Ends in 11h`, or a `Lifetime` label matching the sheet's `Room lifetime` (`:164`) — and add `of 10` to the member count (`:114`) so desktop matches the sheet's honesty at `:157`.

**Suggested command:** `/impeccable layout`

### [P2] Every control in the room boundary is a cobalt primary; the mobile size override is dead CSS

**Why it matters.** `.room-boundary button` (`app.css:2046-2056`) gives every admitted-boundary button 44px and 8px radius, then `:2060-2064` overrides the quiet fill with `background: var(--action)`. There is no quiet button weight inside the room. Desktop `Settings` (`:90-96`) is a solid cobalt slab beside a transparent outlined Back link; mobile `Details` is a cobalt slab; inside the sheet `Expand` and `Close` are two identical cobalt slabs in a `space-between` row (`app.css:5526-5533`), with a third cobalt `Settings` below. DESIGN.md is explicit that room controls use three weights and reserves cobalt for identity/navigation/selection/action. A host-only configuration dialog is now the loudest thing in the header — louder than Live/Full, louder than the countdown — and the sheet's two controls give no clue which one leaves.

Cascade detail: `.room-live-header__details-trigger { min-height: 2.5rem }` (`app.css:5491-5495`) at specificity 0-1-0 loses to `.room-boundary button` at 0-1-1 — **dead CSS**. `.room-live-header__back` is an `<a>`, unmatched by that rule, so its mobile `min-height: 2.5rem` (`:5464-5467`) *does* apply. The two mobile header controls sit at 40px and 44px side by side, and the 40px one misses the 44px target.

**Fix.** Scope the cobalt fill to controls that earn it; give header and sheet controls the quiet bordered weight already defined at `app.css:2048-2055`, reserving the fill for Close at most. Delete the dead override at `:5491-5495` and raise the mobile Back link to 44px from one rule.

**Suggested command:** `/impeccable polish`

## Cognitive Load

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Single focus | **FAIL** | Two rows offer identity, four state facts, up to five metadata atoms, no designated primary |
| 2 | Chunking ≤4 | **FAIL** | Fully populated row two ≈ 11 atoms in one group (`:110-120`) |
| 3 | Grouping | **FAIL** | Uniform `gap: 0.875rem` between all five grid children (`app.css:5344`); no separators or differential spacing. Lifetime, occupancy and identity read as one list |
| 4 | Visual hierarchy | **FAIL** | Static identity at 36px/500 (`app.css:3625-3632`); the two values that actually change are 13px (`:5329`, `:5399`). Hierarchy inverted against volatility |
| 5 | One thing at a time | PASS | Header never blocks; Details is opt-in, Settings is separate |
| 6 | ≤4 options per decision | PASS | Max three visible controls at any decision point (sheet: Expand, Close, Settings) |
| 7 | Working memory | **FAIL** | Desktop shows `7 members` (`:114`), the sheet shows `7 of 10` (`:157`) — the cap is held in the user's head on the surface that needs it |
| 8 | Progressive disclosure | **FAIL** | Correct on mobile, absent on desktop: `app.css:5315-5319` hides the Details trigger ≥768px, so a truncated description, a clipped fifth tag, and the capacity denominator have no expansion path for a non-host desktop member |

**6 of 8 failures — high cognitive load, critical.** No decision point exceeds four visible options.

## Emotional Journey

A 12-hour countdown on a social space is a genuinely interesting design problem, and this header does not engage with it. **Menacing quietly, then abruptly.**

For roughly eleven and a half of the twelve hours the countdown is indistinguishable from the member and Stream counts (`app.css:5396-5401`) — ambient telemetry, not a fact about the conversation's mortality. Then the escalation arrives as three unannounced restyles of the same seven characters:

- **30 min** (`app.css:5432-5435`): colour to `--ink`, weight 600. Restrained and correct in spirit — but the only change is emphasis on a string users have spent eleven hours learning to ignore.
- **10 min** (`:5437-5440`): text turns `--host`, the **success/host green**. Wrong emotional signal, wrong semantic family.
- **2 min**: `Math.ceil` keeps the state at `ten-minute` down to 61 seconds (`room-countdown.ts:9`), so the header shows `2m left` in success green.
- **1 min** (`:5442-5448`): warning amber, weight 750, tinted pill — correct per ADR 0103, but the 30s poll can make it a thirty-second warning, and `Ending now` can land after the room is gone.

**Expiry has no emotional shape at all.** The label goes `Ending now` and the boundary swaps to the Past Stream summary. No anticipatory copy — no "this room can't be extended," no "start a new one." ADR 0075 is explicit that continuing requires a new room; the surface that owns the countdown never says so. The Activity feed carries the canonical sentence (`room-service.ts:279-296` → `RoomCompanionDock.tsx:902-903`, "This room ends in 30 minutes.") — the right words, in a tab that is not the dock's default.

Honest summary: for most of its life the countdown is anxiety-shaped without being informative, and at the moment it matters it is either green, thirty seconds late, or both.

## Persona Red Flags

**Jordan (first-timer).** Reads a 36px room name, `Public`, `Live`, and a grey ribbon ending `7 members 2 Streams 11h left`. Nothing states the cap is 10 (`:114` omits the denominator `:157` includes), nothing states what has 11 hours left, nothing states the room cannot be extended. `Host Marina Ito` (`:222-229`) is the only labeled fact, so the three numbers beside it read as the same kind of thing — Jordan will parse `11h left` as how long the room has been running, or how long their session lasts. When the host steps away they see `Host Unavailable` (`:232`) in the same muted grey as everything else — reads as a product fault, not a transient state.

**Sam (accessibility-dependent).** The countdown's accessible name is `"Room expires in 665 minutes"` (`room-countdown.ts:22`) — accurate, cognitively useless — applied via `aria-label` on a `<time>` (`:54`) that has no implicit ARIA role, so name support is inconsistent; Sam may hear the raw `11h left` with no subject. Same problem on `aria-label="Room tags"` on a bare `<span>` (`:214`). The 30/10/1 escalation is carried **entirely** by colour and font-weight (`app.css:5432-5448`) with no live region and no textual change beyond the ticking number, so the warning ladder is invisible to Sam. Opening Settings from the Details sheet leaves Escape closing the sheet behind the modal and moving focus under the scrim (`:44`, `:194-197`).

**Casey (distracted mobile).** Taps Details to check the host; the room bar — Stream, Chat, People, Activity, **Leave** — vanishes under an opaque sheet (`app.css:5501-5516` z-18 over `:4913-4918` z-17). Outside taps do nothing, there is no drag handle, and the only exit is a `Close` button visually identical to `Expand` beside it. If Casey hits the 40px Back link (`app.css:5464-5467`) they leave the live room instantly — full document navigation, no confirmation, no blocker in the codebase — even mid-stream, while the shelf's Leave is deliberately gated.

## Minor Observations

- `.room-live-header__tags` uses `overflow: hidden` with no `text-overflow` and no overflow indicator (`app.css:5380-5386`). With five tags the container **clips the last chip mid-glyph** with nothing saying more exist. Chips carry `flex: 1 1 auto` (`:5391`), so two short tags *grow* to 7rem each — chip width is a function of sibling count, not content.
- `.room-live-header__description` has `min-width: 2rem` (`:5359`). At narrow desktop widths it renders roughly two characters plus an ellipsis; below a usable threshold it should drop out entirely.
- Neither description nor category (`:5373-5377`, capped 9rem) carries a `title`, and Details is hidden ≥768px — a truncated description is **unrecoverable for a non-host desktop member**. Hosts can only read it via Settings.
- The sheet says "Room details" three times: `aria-label` (`:124`), eyebrow (`:146`), then repeats the room name (`:147`) still visible two lines above.
- `.room-details__empty` (`:205`) has **no CSS anywhere** — "No category or tags" renders unstyled inside a surface where every sibling is deliberately styled.
- `<time dateTime={expiresAt}>11h left</time>` (`:53-60`) pairs an instant in the machine-readable attribute with a duration in the text.
- `useState(() => Date.now())` (`:23`) runs on the server during SSR and again at hydration; across a minute boundary the two produce different label text and React patches a text mismatch.
- The header has no border, background, or elevation and sits `1.5rem` (`app.css:3578`) above a midnight media canvas that is dark in both themes. Two rows of muted text float on the canvas with no edge separating identity chrome from workspace.
- `.room-header` (`app.css:3592-3598`) is applied at `:64` purely so `.room-boundary--admitted .room-header` can place it in the grid; every one of its own declarations is immediately overridden by `.room-live-header`. Split the placement hook from the layout class.
- `grid-template-columns` on the primary row has exactly five tracks (`:5291`) and today receives exactly five participating children on both desktop-as-host and mobile. Correct by coincidence — a sixth item silently breaks the row.
- Nothing in the block has a `transition`. The 55dvh → 90dvh resize (`:126`, `app.css:5518-5524`) is an instant jump and the sheet mounts with no entrance. DESIGN.md specifies 180ms for sheets and 240ms for layout on `cubic-bezier(0.2, 0.8, 0.2, 1)`; the tokens exist and are used elsewhere in this same stylesheet.
- Four back-affordance treatments now exist across room states: `.room-live-header__back`, `.room-boundary__back`, `.admin-back-link`, `.public-profile__home`.
- `detailsOpen` has no resize handling: resizing mobile→desktop with the sheet open leaves it mounted, invisible (`app.css:5450-5452`), with its document-level Escape listener live and its trigger hidden.

## Questions to Consider

1. **What is this header's one job?** It answers "which room is this" loudest and "how long does it have" quietest. In Operate mode those priorities are inverted. If the name dropped to `--text-section` (24px) and the countdown gained a label and a size, what would be lost?
2. **Should the 12-hour deadline live in the header at all, or only the escalations?** An eleven-hour number nobody reads trains people to ignore the field that eventually matters. A quiet `Ends 9:40 PM` that becomes a live countdown at 30 minutes may warn better than a timer ticking since breakfast.
3. **What is the sentence a member needs at 10 minutes?** ADR 0075 says nobody can extend. Activity says "This room ends in 10 minutes." Neither says "make a new one" — and the header says nothing. Who owns the handoff?
4. **Why does the join boundary change the visual language of privacy and capacity?** If Home's violet and amber are right for a room you are deciding about, what makes grey and pink right for the same room once you are inside it?
5. **Should Back/Home behave differently from Leave?** Same effect on a live room, opposite friction. Either Back needs a guard while streaming or hosting, or Leave's confirmation is over-engineered.
6. **What should the header do when the host is gone?** `Unavailable` is a null render dressed as a state. Is host-transfer-pending real enough to name, and does it belong in the Host slot or beside Live?
7. **Does desktop need Details?** The mobile sheet is the best-built part of this component, and desktop members with a long description, five tags, or a capacity question have no equivalent. Progressive disclosure was implemented, then breakpointed away.
