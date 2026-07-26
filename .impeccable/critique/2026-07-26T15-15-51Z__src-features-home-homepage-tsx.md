---
target: home
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-07-26T15-15-51Z
slug: src-features-home-homepage-tsx
---
Method: dual-agent (A: HomeDesignAssessment · B: HomeEvidenceAssessment)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Presence, pending, updating, and Retry states exist; Home lacks a strong realtime/success cue. |
| 2 | Match System / Real World | 3 | Clubhouse, rooms, streams, and privacy fit; “Accounts” and “Room Memberships” sound operational. |
| 3 | User Control and Freedom | 2 | Filters and dialogs are reversible; OAuth and several transitions offer little visible escape or reassurance. |
| 4 | Consistency and Standards | 3 | Components are cohesive; anonymous `Profile`/`Discord` and `Create`/`Create Room` labels diverge. |
| 5 | Error Prevention | 2 | Validation exists, but empty/error facets remain actionable and authentication safeguards are vague. |
| 6 | Recognition Rather Than Recall | 3 | Search, filters, metadata, and counts are visible; icon-only controls lean on tooltips/ARIA. |
| 7 | Flexibility and Efficiency | 2 | URL-backed debounced search is efficient; no shortcuts, favorites, or repeat-user accelerators exist. |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained token system; empty-state dead space, repeated actions, and zero-facet copy add noise. |
| 9 | Error Recovery | 2 | Section Retry exists; generic unavailable/sign-in copy lacks cause and next-step guidance. |
| 10 | Help and Documentation | 1 | No visible help or joining explanation; the empty-state paragraph carries the entire burden. |
| **Total** |  | **26/40** | **Acceptable; significant improvement needed** |

## Design Specificity Verdict

**LLM assessment:** Moderately product-authored, not fully distinctive. The clubhouse vocabulary, Live/Private semantics, presence, restrained no-stock empty state, editorial room-card architecture, and cobalt/pink semantic palette belong to BhayanakCast. In the observed zero-room state, however, the surface collapses into a generic three-column dashboard with standard panels and repeated CTAs. Its strongest product character depends on data that was not available locally.

**Deterministic scan:** The CLI detector returned `[]` for `src/features/home`: zero findings, rules, files, or lines. The rendered-page detector found two contextual warnings. “Single font without hierarchy” is a false positive because PRODUCT.md and DESIGN.md explicitly require Source Sans 3 and the implementation uses a fixed scale with substantial weight/size hierarchy. “Hairline border with wide shadow” identifies the search field’s deliberate 1px border and broad elevation; it is a taste signal, not an unambiguous defect.

**Visual overlays:** Injection succeeded on the desktop page. The browser detector reported two anti-patterns and rendered three overlay nodes. The evidence tab was closed after collection, so no reliable user-visible overlay remains open.

## Overall Impression

Calm, responsive, and more product-aware than a stock app shell. The empty Home does not yet deliver the promised lively clubhouse: duplicated authentication/creation choices and a large quiet center make absence—not community—the emotional peak. The single biggest opportunity is to make the zero-room state decisive and socially reassuring while preserving the restrained brief.

## Cognitive Load

Moderate: three checklist failures.

- **Single focus:** Search/filter controls, a five-row statistics rail, and up to three Create/sign-in affordances compete with discovery.
- **Chunking:** A populated room card may combine state, visibility, category, five tags, member count, and stream count.
- **One thing at a time:** Desktop exposes query, two facets, statistics, CTA, and live/empty content simultaneously.
- No single decision widget exceeds four choices. The nearest overload is five informational statistics and five persistent mobile chrome actions across the top and bottom bars.

## Emotional Journey

Arrival is calm and legible: brand, connected count, search, and theme are immediately available. “Live Rooms” and its semantic live marker promise energy. With no rooms, the journey falls into a large visual valley: “The clubhouse is quiet,” repeated authentication/creation routes, and a tall zero-statistics rail reinforce absence. Create Room is clear, but competing labels weaken commitment. Search failure is understandable but emotionally flat. A populated-room peak could not be verified because the local backend returned no rooms or Past Streams.

## What’s Working

1. **Product-correct empty discovery.** No fake thumbnails, illustration, or fabricated activity. Public/private context and the first-community cue respect the brief.
2. **Responsive information architecture.** Desktop uses the intended left/center/right composition; mobile changes structure with a fixed top bar, labeled bottom navigation, Filters sheet, and collapsed statistics without horizontal overflow.
3. **Strong accessibility foundation.** Semantic headings/regions, large controls, visible focus, native dialogs, focus return, status/alert messaging, and single-link room cards are built into the implementation.

## Priority Issues

### [P1] Anonymous mobile navigation contradicts the product contract

- **Why it matters:** At 390px, anonymous visitors see top `Log in` plus bottom `Profile`, although the brief requires one bottom `Discord` affordance with the accessible name `Continue with Discord`. Two differently named controls for the same authentication action increase hesitation and break expectation.
- **Fix:** On small anonymous Home, visibly label the bottom action `Discord`, give it the full accessible name, and remove the duplicate top login control. Preserve the separate Create OAuth intent.
- **Suggested command:** `$impeccable adapt` followed by `$impeccable clarify`

### [P1] Room-card accessible names hide join-critical state

- **Why it matters:** `LiveRoomCard.tsx` overrides the link name with `Open {room} room`, suppressing Live/Full, Public/Private, member, and stream information already present inside the link. Screen-reader users lose the state required to decide before admission.
- **Fix:** Remove the overriding `aria-label`, or compose one that includes state, privacy, capacity, and stream availability while retaining the one-link card contract.
- **Suggested command:** `$impeccable audit`

### [P1] The empty-state composition is visually dead and action-duplicated

- **Why it matters:** The desktop center leaves a large blank lower region while left Create, center Create Room, and right Sign in with Discord compete. Instead of a confident invitation, the first viewport communicates inactivity and indecision.
- **Fix:** Tighten the invitation’s vertical footprint, establish one primary contextual CTA, visually demote required persistent Create affordances, and normalize action labels.
- **Suggested command:** `$impeccable layout` followed by `$impeccable distill`

### [P2] Empty facets and recovery copy do not guide the next step

- **Why it matters:** The page announces zero categories and tags while leaving facet inputs available. Generic unavailable/Retry and sign-in errors do not distinguish no data from failure or explain recovery.
- **Fix:** Hide or disable facet fields when no options exist, distinguish empty from failed data, and replace generic errors with concise cause/next-action guidance.
- **Suggested command:** `$impeccable harden` followed by `$impeccable clarify`

## Persona Red Flags

**Jordan (first-timer):** The search heading is clear, but Jordan must infer “streams,” “Room Memberships,” Create versus Sign in, and how joining works. Bottom `Profile` unexpectedly starts Discord authentication, while no contextual help explains the path. Likely hesitation before the first action.

**Casey (distracted mobile):** The 390px layout has thumb-friendly bottom navigation and no overflow, but five persistent chrome actions span the top and bottom bars. Duplicate Log in/Profile controls and a third mid-page CTA force re-evaluation during an already empty journey.

**Riley (stress tester):** `?q=abc` correctly persists URL state and exposes Clear all with zero results. Facet inputs remain enabled with zero options, and failure states fall back to generic unavailable/Retry copy. Private/full cards, populated search, and network failures were not observable with the empty backend.

## Minor Observations

- `1 accounts connected` needs singular grammar.
- `The clubhouse is quiet,` ends with an awkward comma.
- The mobile theme control is icon-only; its accessible name is present, but the visual state is less immediate.
- `0 categories and 0 tags available` gives zero-data bookkeeping too much prominence.
- `Today’s peak Accounts` uses awkward product-internal capitalization.
- Past Streams and populated-room density could not be visually evaluated because the local backend returned no data.

## Questions to Consider

- Should empty Home present one decisive invitation and demote repeated Create/authentication controls?
- Is a five-row statistics rail earning first-viewport space when no rooms are live, or should one human signal—people here now—carry the social proof?
- If anonymous visitors should browse first, why show both Log in and Profile instead of one explicit Discord action?
- What must the first populated room card do to create the promised lively clubhouse peak rather than another dashboard card?
