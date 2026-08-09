---
target: companion dock
total_score: 25
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-08-08T21-37-53Z
slug: src-features-room-roomcompaniondock-tsx
---
Method: dual-agent (A: DockDesignScout/15501fd10fcf9497 · B: DockDetectorEvidence/15501fde0a4f9499)

# Companion Dock Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Unread, typing, pending, failure, and reconnect states are strong; Activity omits time context and the mobile composer disappears under the room bar. |
| 2 | Match System / Real World | 3 | Chat, People, and Activity are natural room concepts; `Desktop only` appears as the mobile control label instead of explaining the Stream control. |
| 3 | User Control and Freedom | 2 | Close, Escape, focus return, collapse, and 55%/90% controls exist, but the default mobile sheet obstructs the primary Chat action and the collapsed rail has no explicit Expand control. |
| 4 | Consistency and Standards | 3 | Responsive behavior, tokens, tabs, and menus are coherent; People omits avatar and reconnecting state required elsewhere in the room. |
| 5 | Error Prevention | 2 | Send constraints and disabled states prevent invalid sends, but mobile users can open Chat into a state where the textarea and Send control are obscured. |
| 6 | Recognition Rather Than Recall | 2 | Visible tabs and badges help while open; collapsed labels are clipped, the mobile Stream destination is not named, and the empty composer has no visible invitation. |
| 7 | Flexibility and Efficiency | 3 | Arrow/Home/End tab navigation, Enter-to-send, and room-session draft/scroll retention support repeat use; mobile requires an extra Expand action to recover the composer. |
| 8 | Aesthetic and Minimalist Design | 2 | Compact density is appropriate, but the empty Chat panel is a large undifferentiated blank surface and the visual language remains generic. |
| 9 | Error Recovery | 3 | Pending messages canonicalize, failures retain Retry/Discard, mute failures recover, and reconnect copy is specific. |
| 10 | Help and Documentation | 2 | There is no visible composer guidance, collapsed-rail expansion cue, or explanation tying `Desktop only` to Stream. |
| **Total** | | **25/40** | **Acceptable — significant improvements needed before release** |

## Design Specificity Verdict

**LLM assessment:** The structure is unmistakably authored for BhayanakCast: one room-session dock separates Chat, People, and lifecycle Activity; preserves draft, unread, and scroll state; and becomes a wide dock, medium non-modal drawer, or explicit 55%/90% mobile sheet. The visual expression is not equally specific. A neutral rail, plain cobalt tabs, text-only People rows, and a blank Chat state could belong to any chat or admin product. The community-clubhouse promise is present in behavior, not yet in social warmth or composition.

**Deterministic scan:** The source scan completed with exit code 0 and returned **0 findings** for `src/features/room/RoomCompanionDock.tsx`.

**Visual overlays:** Mutable injection succeeded in the fresh Assessment B browser tab. The overlay produced **2 runtime findings** across 1440×900, 1024×800, and 390×844 inspection:

- `layout-transition` on `.room-dock`, mapped to `src/styles/app.css:4476` (`transition: width 240ms …`). This is real, even though its duration/easing follow the brief and reduced motion disables it.
- `single-font` at page level. This is a false positive: `PRODUCT.md` and `DESIGN.md` explicitly require Source Sans 3 throughout, with size and weight supplying hierarchy.

The overlay remains visible in the Assessment B browser tab; the temporary detector and fixture servers were stopped. Console collection was unavailable even for an explicit preflight log, so the reliable browser signal is the visible overlay DOM and labels, not console output.

## Overall Impression

This is a strong interaction model inside a visually under-resolved shell. The biggest opportunity is to make the dock a legible social workspace—especially on mobile—rather than a generic panel that happens to contain correct room behavior.

## What's Working

1. **The state model respects live conversation.** Chat opens by default; draft, active tab, and per-tab scroll positions survive transitions; unread and `New messages`/`New activity` cues do not steal focus.
2. **Recovery and safety are concrete.** Pending messages canonicalize, failed messages keep Retry/Discard, mute feedback is explicit, member/message actions remain reachable without hover, and Close/Escape restores focus.
3. **The responsive shell matches the room contract.** Live inspection confirmed a 360px persistent wide dock, a 360px medium overlay without scrim or mosaic reflow, and mobile sheets at 55% and 90%. Mobile sheet controls and tabs measured 44px high.

## Cognitive Load

**2 of 8 checklist failures: moderate.**

- **Fails visual hierarchy:** the collapsed rail clips every tab label; the mobile Stream control reads only `Desktop only`; empty Chat offers no visible invitation.
- **Fails minimal choices:** the mobile room bar exposes five equal controls, and an authorized Host member menu can expose five actions.
- **Passes single focus, chunking, grouping, one thing at a time, working memory, and progressive disclosure:** one tab owns the panel at a time, tabs and menus group secondary actions, and room context remains visible.

Decision points above four visible options:

- Mobile room bar: Stream/`Desktop only`, Chat, People, Activity, Leave.
- Authorized Host member menu: Report, Transfer Host, Stop Stream, Kick, Ban when all apply.

## Emotional Journey

Chat-first admission is quiet and low-friction. People count, typing presence, canonical send feedback, and Activity warnings can build social reassurance. The valleys are sharper than they need to be: collapsing removes visible orientation, People feels impersonal without avatars or reconnecting state, mobile Chat opens with its composer under the room bar, and `Desktop only` reads as a dead end. The end state should leave users feeling connected and in control; today the strongest emotional moment is error recovery rather than successful participation.

## Priority Issues

### [P1] The default mobile Chat sheet obstructs its primary action

**Why it matters:** At 390×844 and 55%, the textarea occupied y=728.8–800.8 while the fixed room bar began at y=767, obscuring 33.8px. Send occupied y=806.8–850.8, extended beyond the viewport, and was covered for 37.2px. Opening Chat does not reliably let Casey type and send; Expand is an undocumented workaround.

**Fix:** Reserve the room-bar height and safe-area inset below the sheet content, give the composer a protected non-shrinking slot, and allow the panel—not the composer—to shrink below its current 12rem minimum. Keep textarea and Send fully visible at 55%, 90%, short mobile heights, and with the software keyboard open.

**Suggested command:** `/impeccable adapt`

### [P1] Collapse removes orientation without exposing an explicit way back

**Why it matters:** At `data-open="false"`, CSS clips every `.room-dock__tab-label` to 1px. The component renders no explicit `Expand dock` control in the collapsed state. A first-time or low-vision keyboard user must infer that the remaining unlabeled-looking tab controls reopen the dock.

**Fix:** Keep recognizable icons with visible hover/focus tooltips and add an explicit Expand dock control with `aria-expanded`. Preserve tab badges, the active destination, and focus return without relying on hidden text alone.

**Suggested command:** `/impeccable clarify`

### [P1] People does not communicate the social and connection state the room requires

**Why it matters:** Each People row renders only display name plus Host/You/Streaming. The accepted room contract calls for avatar identity, reconnecting/compatibility state, and sanction-relevant local capability state. A stale reconnecting member currently looks active, and a text-only list weakens the clubhouse's most social surface.

**Fix:** Compose each row from avatar/initial fallback, name and relationship, explicit semantic connection/stream state, then the quiet action menu. Keep ordering and privacy rules unchanged.

**Suggested command:** `/impeccable harden`

### [P2] Empty Chat is visually blank and the composer does not invite the first message

**Why it matters:** Wide and medium screenshots show almost the full dock as empty surface. The textarea has a screen-reader label but no visible label, placeholder, or Enter/Shift+Enter guidance; disabled Send becomes the only visible cue. Jordan cannot tell whether Chat is ready or what action starts participation.

**Fix:** Add a restrained empty state that explains the room is ready for conversation, give the textarea a visible invitation or placeholder, and keep keyboard/limit guidance close to the composer without turning the dock into onboarding.

**Suggested command:** `/impeccable clarify`

### [P2] The mobile Stream destination is labeled as a limitation

**Why it matters:** The first room-bar control visibly reads `Desktop only` instead of `Stream`. Users cannot map it to the cross-device Stream destination, and the limitation sounds like a status banner rather than a disabled action.

**Fix:** Keep `Stream` as the primary label and render `Desktop only` as secondary explanatory text or accessible description. Preserve the disabled state and 44px target.

**Suggested command:** `/impeccable adapt`

## Persona Red Flags

**Casey (Distracted Mobile User):** Opening Chat at 55% leaves the textarea partially covered and Send almost entirely behind the fixed room bar. Five equal room-bar controls compete for attention, while the first says only `Desktop only`. Casey must discover Expand before completing the primary action.

**Jordan (First-Timer):** Collapsing the dock removes all visible tab labels and offers no explicit Expand action. Empty Chat is a large blank field with no visible invitation. People provides names without avatars or reconnecting context, weakening recognition and trust.

**Sam (Accessibility-Dependent User):** The tablist has strong keyboard behavior, but the mobile sheet opens as a complementary `aside` and the source moves no focus into it; focus return exists only on close. The 55% composer occlusion affects zoom and motor users first. Visually clipped collapsed labels also leave keyboard users without persistent orientation.

## Minor Observations

- Activity's empty copy, `Nothing has happened yet.`, is direct and appropriate.
- Only the one-minute lifecycle event receives warning prominence, matching the room contract.
- Activity entries omit their available time value, reducing scanability after attention shifts away.
- Unknown Activity kinds can return an empty label and create a blank list item.
- The 500-character count appears only from 450 onward. This keeps noise low but reveals the constraint late.
- The width transition is a real layout-animation cost. Reduced motion is correct, but `/impeccable optimize` should test whether transform or a non-animated grid cutover preserves the authored collapse without repeated layout.
- Live evidence used an authenticated Host, one member, empty Chat/Activity, and no Streams. Multi-member ordering, unread, typing, failed sends, moderation menus, and reconnect states were source-reviewed but not live-exercised.

## Questions to Consider

- If this is a community clubhouse, why does People feel like a text settings list instead of the social center of the room?
- Should a 55% Chat sheet ever require expansion before the first message can be sent?
- If collapse hides every label, what teaches a first-time user that the rail can reopen?
- Is `Desktop only` a state message or a navigation label—and can the control say both clearly?
