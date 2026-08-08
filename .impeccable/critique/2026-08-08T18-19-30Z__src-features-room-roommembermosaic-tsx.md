---
target: member mosaic
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-08T18-19-30Z
slug: src-features-room-roommembermosaic-tsx
---
Method: dual-agent (A: MosaicDesignReview · B: MosaicDetectorEvidence; live browser evidence: MosaicLiveEvidence)

Target: `src/features/room/RoomMemberMosaic.tsx` + mosaic rules in `src/styles/app.css`. Mode: **Operate**.

Evidence base: the real admitted room at `http://127.0.0.1:3000/rooms/cb80aee5-…` with six seeded members (You / Host+stream / long-name streamer with 3 watchers / streamer with no preview / reconnecting / no-avatar), measured and captured at 1440, 1280, 1024 and 390 in both themes.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Retry progress is exemplary (`attempt 2 of 4`), but muted-vs-audible and peer-reconnecting are text-only, and no `aria-live` exists anywhere. |
| 2 | Match System / Real World | 3 | Three names for one state: badge `Screen up`, footer `Live`, ADR 0101 `Sharing`. |
| 3 | User Control and Freedom | 3 | Stop/Retry/Mute all explicit and reversible, but `Stop watching` is the label while merely *connecting*. |
| 4 | Consistency and Standards | 2 | Off-token radii (10px tile vs `--radius-card` 12px; 5px chip), `--warning` used for an error, `--host` green claiming the whole state line, four dead `data-*` attributes. |
| 5 | Error Prevention | 3 | Muted-by-default enforced twice; unauthorized actions never rendered. Watch disables for four different reasons with one presentation. |
| 6 | Recognition Rather Than Recall | 2 | Must remember whether you unmuted, and why every Watch went grey. |
| 7 | Flexibility and Efficiency | 1 | No shortcut for the primary repeated action; ~18 tabs to the 9th member's Watch; the filter resets every session. |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely restrained. Loses points for the six-fragment state string and the duplicated failure message. |
| 9 | Error Recovery | 3 | Best copy on the surface, painted in the wrong colour family and never announced. |
| 10 | Help and Documentation | 0 | No inline reason for a disabled Watch; `Chat only` is terminal with no explanation, though `retryCompatibility` exists. |
| **Total** | | **22/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**LLM assessment.** Authored for this product in structure, generic in execution. The specificity lives in the TSX and evaporates in the CSS.

Product-specific and load-bearing: the presence tile anchored by a real avatar with no camera-off iconography (`RoomMemberMosaic.tsx:174`); the non-interactive preview thumbnail with Watch as a separate named control (`:166-172`, `:267-274`); order stability as a mechanism, not a sort (`room-roster.ts:56-72` through a ref at `:44-49`), which makes speaker-detection reordering unrepresentable; preview-freshness vocabulary tuned to the two-minute cadence (`:299-310`); bounded named retry progress.

Generic in the rendered result: `repeat(auto-fill, minmax(15rem, 1fr))` with uniform charcoal cards *is* the conference grid; `data-member-sharing` and `data-member-self` are emitted (`:141-142`) and carry **zero** CSS; `.room-boundary button` (`app.css:2057-2061`) paints every control solid cobalt so the watched footer is four identical primaries; no motion token is used anywhere in the mosaic; `Live` renders in `--ink-muted` while the only Live-coloured element also carries `Connecting…` and `Could not connect`.

**Deterministic scan.** `detect.mjs` on `RoomMemberMosaic.tsx`, `RoomMemberActions.tsx`, `RoomAdmittedBoundary.tsx`: exit 0, zero findings. Over `app.css` it reports one `layout-transition` warning (`transition: width` on `.room-dock`) — real but outside this target. Token inventory: no hard-coded hex in mosaic scope; every `font-size` on the fixed ramp; three off-token radii (`.room-mosaic__tile` 10px, `.room-mosaic__sharing` 5px, watcher avatars hardcoded `50%`); **zero** transition/animation declarations in any `.room-mosaic*` rule.

**Where the detector and the review disagreed.** The detector is clean on the component because the component's problems are omissions — unused tokens, unstyled state hooks, missing live regions — which no rule-based scanner detects.

**Where live evidence overturned the review.** Assessment A predicted the watcher stack's `aria-label` on a `<p>` (`:329-332`) would be dropped by AT. Chrome's accessibility tree returns the computed name verbatim: `Watched by Goti, Mina Reconnecting, Zoë; 3 watchers total`. ARIA still prohibits naming a `generic` role, so this is a portability risk, not the P0 it was called. Measured contrast also passes where the review implied risk: `.room-mosaic__state` 4.74:1 light / 5.74:1 dark; `.room-mosaic__failure` 4.71:1 light / 8.48:1 dark.

**False positive.** The static pass flagged all 390px cells as below the 240px minimum. That floor is a desktop/medium rule; the brief specifies a two-column mobile overview and `app.css:4668-4671` implements exactly that.

## Overall Impression

The thinking is better than the surface. Every hard decision — one watch, no hover, no camera-off tiles, stable order, honest retry — was made correctly and is structurally enforced in code. Then none of it was given a visual voice. Of 30 reachable tile states, 8 are distinct at a glance, 11 differ only by words inside one 13px muted `·`-joined string, and 6 collide outright. The biggest opportunity is not new features: it is spending the semantic colour, weight and motion tokens the design system already defines on the states the component already computes.

## What's Working

1. **The non-interactive preview thumbnail, held honestly.** A bare `<img>` with no handler and no wrapping button; the `<li>` carries none either. This resists enormous convention pressure and makes "no connection starts without your say-so" structurally true rather than merely stated.
2. **Order stability as a mechanism.** `preserveRoomRosterOrder` keeps positions and appends; the deliberate divergence from People's ordering shows someone reasoned about what each surface is *for*. In a 10-person room where sharing churns constantly, the tile you were about to click never moves.
3. **Bounded, honest retry progress.** `Connecting… attempt 2 of 4` against a jitter-free 1s/2s/4s policy, then exhaustion copy that scopes the damage: "Chat and the rest of the room keep working." The difference between failing and failing well.

## Priority Issues

**[P0] The watch lifecycle is silent to assistive technology.**
*Why it matters:* No `aria-live` exists anywhere in the component. Connecting, attempts 2–4, exhaustion with guidance (`:210-218`), connected and stream-ended all mutate the DOM with no announcement. A screen-reader user presses Watch and gets nothing for up to ~60 seconds on the surface's single primary action. WCAG 2.2 AA status-message failure. Compounding it, the live focus order confirms ten buttons named only `Watch` with no streamer context, while `RoomMemberActions.tsx:62` already does this correctly as `Actions for {displayName}`.
*Fix:* One polite live region fed by `sharingLabel(attempt)` plus the failure text. Name Watch per member. Give the `<li>` an `aria-labelledby` pointing at `.room-mosaic__name`. Move the watcher label off the `<p>`.
*Suggested command:* `/impeccable harden`

**[P1] Every button in the tile is a solid cobalt primary.**
*Why it matters:* `.room-boundary button` paints Watch, Unmute, Fullscreen, Stop watching and Actions identically, and `.room-mosaic__watch` has no rule at all. Confirmed in the live screenshots. It also places the exit and a menu containing Kick/Ban 6px apart at identical weight — a touch safety hazard.
*Fix:* Three-tier scale inside `.room-mosaic__actions`: Watch keeps cobalt fill; Mute/Fullscreen become ghost; Stop watching becomes bordered secondary; Actions goes lowest. Replace `opacity: 0.6` disabled with a real disabled token.
*Suggested command:* `/impeccable colorize`

**[P1] Semantic colour is absent or misapplied on every state.**
*Why it matters:* `Live` renders in `--ink-muted`. The only Live-coloured element also carries `Connecting…` and `Could not connect`, so failure wears the celebration colour. Exhausted retries use `--warning` where danger belongs. `--host` green claims the entire state line, so a reconnecting host reads `Host · Reconnecting` in success green.
*Fix:* Split the state line into discrete spans with their own tokens and a non-colour carrier each; repaint `.room-mosaic__sharing` by state; pick one word for the sharing state across badge, footer and ADR.
*Suggested command:* `/impeccable colorize`

**[P2] Six tile states are visually indistinguishable from states that mean something different.**
*Why it matters:* Muted vs unmuted differ only by a button verb. Watch-disabled-because-incompatible vs disabled-because-a-connect-is-in-flight look identical. A self tile whose capture died shows your own stale thumbnail labelled `You · Live`. A reconnecting peer looks healthy.
*Fix:* Use the `data-*` attributes the component already emits and the CSS ignores; add `data-member-audible`; dim reconnecting tiles; `aria-disabled` plus an inline reason instead of bare `disabled`; gate the self `Live` label on `media.localStream !== null`.
*Suggested command:* `/impeccable harden`

**[P2] Zero motion on the surface's most significant moment.**
*Why it matters:* No `.room-mosaic*` rule declares a transition. A stream you asked for arriving is delivered as an instantaneous grid reflow — now a larger reflow than before, since the watched tile promotes to a full-width first-row stage. The brief specifies 240ms with `--ease-clubhouse` for exactly this, and `--animate-live-pulse` is defined and never applied.
*Fix:* Transition the animatable properties on the tile at `var(--transition-duration-layout) var(--ease-clubhouse)`; cross-fade the preview→video swap; apply the pulse to a genuine Live dot only.
*Suggested command:* `/impeccable animate`

**Resolved during this session.** A sixth issue — the 2×2 feature span leaving ~60–70px of dead space under the watched footer at every member count, plus a phantom empty row below ~4 tiles — was removed by replacing the span with a full-width first-row stage, a one-row stage footer, and a height cap that keeps the next tile row in view (134–266px of it, measured at 1024/1280/1440).

## Persona Red Flags

**Alex (impatient power user).** The only sharing signal is a 13px uppercase chip that also says `CONNECTING…` and `COULD NOT CONNECT` in the same pink. While his previous watch tears down, *every* Watch button in the room greys out at 0.6 opacity with no explanation. Reaching the 9th member's Watch takes ~18 tabs (live focus order confirms two stops per streaming tile). Switching streams labels the new tile `Stop watching` the entire time, so the fast user cancels the thing he just asked for.

**Sam (screen reader + keyboard only).** No live region anywhere. Ten identically-named `Watch` buttons with no tile context, since the `<li>` has no accessible name. `disabled` removes blocked Watch from the tab order, so the blocked state is not even discoverable. On successful watch, Unmute and Fullscreen are injected *before* the focused button in DOM order and its label silently changes meaning.

**Casey (distracted mobile).** At 390px the live measurement is 149.5px cells: the 56px avatar fills over half the media region and the footer is taller than the media. `requestFullscreen` on `HTMLVideoElement` is undefined on iOS Safari (`webkitEnterFullscreen`), so a prominent cobalt button does nothing with no message, on a surface whose brief commits to mobile watch. The ~13px native checkbox is the first interactive element in the region and is far under 44px.

## Minor Observations

- Four `data-*` attributes written and never styled — dead API surface reading as unfinished intention.
- Three off-token radii in one component (10px tile, 5px chip, hardcoded `50%` watcher avatars).
- Destructive colouring in the tile menu is positional (`button:last-child:not(:first-child)`), so `Stop Stream…` is never red and whatever is last always is.
- `stableRoster.current` is assigned during render; order resets on remount, so two people in the same room can hold different tile orders.
- The retry counter is a live count without `tabular-nums`, inside a 0.08em-tracked uppercase badge.
- No loading or error state for the preview `<img>`. Confirmed live: the dev preview endpoint returns 503 and those tiles are indistinguishable from "no preview uploaded yet".
- `Chat only` is terminal with no explanation, though `retryCompatibility` exists on `RoomMedia`.
- The state line has no truncation rule while the name above it does.
- Hide-non-streaming with zero streams empties the list entirely, contradicting the brief's "retain member tiles".
- The empty prompt omits the required pointer to the shelf Stream action.
- At 1024 the companion drawer renders open over the mosaic by default; the spec says it opens on request with explicit Close. Outside this target, worth its own look.
- Fixed in passing: the last watcher avatar's negative margin overlapped the watcher count text — visible in every footer, and unmissable once the stage footer became a single row.

## Questions to Consider

- The footer is taller than the media it describes at the 240px minimum. Nine tiles are context; one is content. Should they use the same template at all?
- What if the tile had two text slots — identity, and a status line owned by exactly one state chosen by precedence (failure > reconnecting > connecting > watching > live > freshness > here)? That collapses 11 text-only states into 7 distinct ones without adding a pixel.
- Now that the stage is full width, the un-watched tiles are literally a supporting row. Should they read that way — quieter, denser, "available, not chosen" — rather than using the same template at a smaller size?
- Badge says `SCREEN UP`, footer says `Live`, ADR says `Sharing`. If the answer is "screen up" — by far the most alive of the three — should the whole surface speak that register instead of borrowing conference words?
- If exactly one animation were permitted in the entire mosaic, should it be the promotion to stage, or the moment a dark avatar tile becomes a moving thumbnail — the moment a room stops being quiet?
