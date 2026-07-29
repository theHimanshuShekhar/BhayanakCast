---
target: home
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-07-28T20-27-23Z
slug: src-features-home-homepage-tsx
---
⚠️ DEGRADED: single-context (harness policy forbids spawning sub-agents unless the user asks; Assessment A was completed and recorded before the detector ran)

Target: `src/features/home/HomePage.tsx` · Mode: Persuade→Operate hybrid (discovery) · Live evidence: `http://localhost:3000/` (already-running dev server), anonymous session, 1512×950 and 390×844.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|------:|---|
| 1 | Visibility of System Status | 3 | Per-section skeletons, `aria-busy`, pending/updating states are thorough. Nothing confirms a realtime update landed — the list just changes. |
| 2 | Match System / Real World | 3 | "clubhouse", "Busiest room", "Wrapped up", "Talking, no screens up" are genuinely this product's voice. Broken by `1 categories 1 tags available.` |
| 3 | User Control and Freedom | 2 | Chips + Clear all + dialog cancel are good; the category field silently reverts your typing on blur, and three different sign-in doors give no hint where you land back. |
| 4 | Consistency and Standards | 2 | Shipped palette is violet, ADR 0096 says cobalt; 23 CSS declarations below the documented 13px floor; three labels for one sign-in action; two competing `.home-statistics` rule blocks. |
| 5 | Error Prevention | 3 | Real per-code validation, `maxLength` everywhere, membership-consequences confirmation before create. The category input's silent revert is the gap. |
| 6 | Recognition Rather Than Recall | 3 | Labeled nav, visible filters, active-filter chips. At ≥768px the rail labels collapse to icon-plus-tooltip. |
| 7 | Flexibility and Efficiency | 2 | Enter flushes the debounce and search state lives in the URL (shareable) — that's the whole accelerator set. No shortcuts, no recents, no favourites. |
| 8 | Aesthetic and Minimalist Design | 2 | The counter is a strong anchor, but a 258px statistics block puts every room below the fold on a phone, and the featured card runs 1345px wide against a documented 1040px center max. |
| 9 | Error Recovery | 3 | Per-section Retry with focus restoration is better than most products ship. Stale children still render under the failure message. |
| 10 | Help and Documentation | 1 | No help, no docs, no community-rules link anywhere — and PRODUCT.md requires the rules stay discoverable. |
| **Total** | | **24/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment.** The *writing* is unmistakably this product. "Talking, no screens up" on a room with no active stream, "Wrapped up / last ten rooms", "Anyone can see it — joining needs the password", "Browse every public room without an account. Signing in is what lets you join one or open your own." Nobody's component library ships those sentences. The preview mosaic — real stream frames, blurred with a lock for private rooms so the card keeps its live texture — is a genuinely authored idea, and the "Busiest room / Also live" split is a real editorial point of view about what a clubhouse index is for.

The *visual system* has drifted off its own brief and now reads category-interchangeable. `src/styles/app.css:100` and `:136` ship `--action: #5d5294` / `#9184d9`, a violet. ADR 0096 — status **Accepted**, not superseded, and no later ADR mentions these values — specifies cobalt `#2457D6` / `#82A5FF`, and DESIGN.md and PRODUCT.md both still describe cobalt. So the one token carrying product identity was swapped for a generic SaaS violet with nothing recording why. The type scale went the same way: ADR 0096 fixes 13/14/16/18/24/30/36px, and the live page renders 14 text nodes below 13px, down to **10px** on the `Live` badge — the single most important word on a room card.

The layout diverges too. DESIGN.md's Home composition calls for three stages, with a 216px left sidebar + fluid center + right utility rail above 1280px. At 1512px the shell computes to `72px 1425px` — the medium stage, applied at every width ≥768px. The wide stage is not implemented; `.home-create-panel` is `display: none` and `.home-utilities-rail` is `display: contents` with no JSX to match.

**Deterministic scan.** `detect.mjs --json` over `src/features/home` and `src/styles/app.css`: `[]`, exit 0, zero findings. The detector's rules are markup/CSS-antipattern shaped and did not reach any of the above — every finding here came from reading source against the ADR and from live measurement. Treat the clean scan as "no generic antipatterns," not as a passing grade.

**Browser evidence.** No overlay injection was attempted — the running server on :3000 is the project's own dev server, not `live-server.mjs`, and I did not restart or mutate it. Evidence is live DOM measurement instead, at 1512×950 and 390×844.

## Overall Impression

The engineering under this page is better than the design on top of it. Loading, retry, focus restoration, placeholder-vs-pending distinctions, URL-canonical search, tabular numerals — this is careful work, and the copy has a real voice. What it does not have is a visual system that matches the one the repo wrote down, and the drift has produced one hard accessibility failure and one structural failure.

**The single biggest opportunity:** on a 390×844 phone, the first live room card starts at y=790 with the bottom nav covering from y=780. A visitor to a room-discovery product sees **zero rooms** on their first screen. The 258px statistics block ("opened today", "peak today") is sitting between the search field and the thing people came for.

## What's Working

1. **The failure and loading model.** `HomeSectionBoundary` (`src/features/home/HomeSectionBoundary.tsx`) gives each section its own skeleton, its own `role="status"` message, its own Retry, and returns focus to the container with `preventScroll` after refetching. Sections fail independently — a dead statistics query never takes the room list with it.
2. **Copy that states consequences, not labels.** `LiveRoomCard.tsx:54-65` deliberately repeats the Private and Full chips as sentences, with the comment explaining why: the chips are labels, the sentence says what they mean to someone deciding to knock. That's the instinct most products skip.
3. **The counter that never reflows.** `HomeUtilities.tsx:119` — one block whose *content* changes between "N people in the clubhouse" and the search-result breakdown, but whose shape doesn't, so nothing below it jumps. Small idea, correctly executed.

## Priority Issues

### [P0] Primary action text fails contrast in dark mode — 2.15:1

**Why it matters.** `--action-ink: #d2cefd` on `--action: #9184d9` measures **2.15:1** on the live page. That's below 3:1, let alone WCAG 2.2 AA's 4.5:1, and it hits `Sign in`, `Log in`, and `Create Room` — every primary conversion control on the page. DESIGN.md commits to AA. Light mode is fine (`#fbfbfd` on `#5d5294`), so this ships broken for exactly the users who chose dark.

**Fix.** This is downstream of Issue 2, so fix it there: ADR 0096's dark pairing is `#0B1630` ink on `#82A5FF` cobalt, which measures ~9:1. Restoring the ADR values resolves the contrast failure as a side effect. If the violet is staying, the dark action ink must go to a dark navy, not a light lilac.

**Suggested command:** `/impeccable colorize`

### [P1] Every room is below the fold on mobile

**Why it matters.** Measured at 390×844, anonymous: counter 72–182, search 202–305, filters 326–410, **statistics 498–756**, live-rooms starting at 790 — under a bottom nav fixed from 780. The statistics strip consumes 31% of the viewport to tell a first-time visitor "opened today: 0, peak today: 0". A discovery surface where discovery requires a scroll has inverted its own priority, and PRODUCT.md's center order exists precisely to prevent this.

**Fix.** Below 768px, either move `StatisticsStrip` beneath Live Rooms, or collapse it to a single line ("1 room live · 1 sitting in rooms"). The five-cell grid earns its space on desktop; on a phone it's a wall between intent and content.

**Suggested command:** `/impeccable layout`

### [P1] The shipped visual system is not the documented one

**Why it matters.** Three separate drifts from ADR 0096 (Accepted, current):
- **Palette:** `app.css:89-140` ships violet `--action: #5d5294` / `#9184d9` and canvas `#f3f3f7` / `#161826`. The ADR specifies cobalt `#2457D6` / `#82A5FF` and canvas `#F6F8FC` / `#0D1422`. Only `--live: #ff72a5` survives intact.
- **Type scale:** the ADR fixes a 13px floor. 23 declarations in `app.css` sit below it; the live page renders 14 nodes under 13px, including the `Live` badge at 10px and every room chip at 11px.
- **Composition:** the ≥1280px stage (216px sidebar / fluid center / right utility rail) doesn't exist. At 1512px the shell is `72px 1425px`.

Design docs that no longer describe the product stop being useful to anyone — including the next agent that reads them. And the drift is what produced the P0 above.

**Fix.** Pick a direction and make it true in one place. Either restore ADR 0096's tokens and scale in `app.css`, or write ADR 0108 adopting violet-and-loose-scale and update DESIGN.md and PRODUCT.md to match. Do not leave both stories in the repo.

**Suggested command:** `/impeccable document`

### [P1] One action, three doors, three labels

**Why it matters.** At 1512px an anonymous visitor sees three simultaneous sign-in controls, all `class="sign-in-button"`, all starting the same Discord OAuth: rail `Discord` (aria "Continue with Discord"), top-right `Log in` (aria "Sign in with Discord", label collapsed to `font-size: 0` at this width), masthead `Sign in` (no aria-label at all). A screen-reader user hears three differently-named controls and has to work out they're the same door. This is the same divergence flagged on 2026-07-26; it has not moved.

**Fix.** One label, everywhere: `Continue with Discord`, abbreviated only where the rail forces it, with the full string as the accessible name in all three places. Then justify each instance or delete it — the masthead `Sign in` sits 300px from the rail's Discord button and does the same thing.

**Suggested command:** `/impeccable clarify`

### [P2] Dead CSS and a duplicated rule layer

**Why it matters.** `.home-statistics__toggle`, `.home-statistics__content`, `[data-expanded="true"]`, `.home-utilities-rail`, and `.home-create-panel` have no JSX counterpart anywhere in `src` — they're the previous design, still shipping. Worse, `.home-statistics` is defined twice with conflicting `display`, `border`, `margin`, and `padding` (`app.css:845` and `:2448`), and `.home-statistics dt/dd` twice with different sizes and weights. The second block wins by order, which means the first is invisible ballast that will mislead the next person who greps for it.

**Fix.** Delete the pre-redesign block (roughly `app.css:841-900`) and the orphaned selectors. `HomeUtilities.tsx:185` already documents *why* the disclosure was removed — the CSS should reflect that decision too.

**Suggested command:** `/impeccable polish`

## Persona Red Flags

**Casey (Distracted Mobile User).** Opens the site on a phone, sees a big number, a search box, a filter row, and five statistics — no rooms. Has to scroll past 790px of chrome to find the one thing the product does. The bottom nav is correctly placed in the thumb zone (fixed, 64px, safe-area aware) and there's no horizontal overflow, so the mechanics are right; it's the content order that fails. `Theme` is 44×40, marginally under the 44pt target.

**Jordan (Confused First-Timer).** Three sign-in buttons with three labels — which one is the real one? Reads `1 categories 1 tags available.` and wonders if the page is broken. Types a category name that isn't in the facet list, tabs away, and watches the field silently empty itself with no message (`HomeFilters.tsx:140-143`). Sees `order holds until you refresh` under "Busiest room" and has no idea what order, or what refreshing would change. Looks for help and finds none — no rules link, no docs, no tooltip explaining what a "room" is before signing in.

**Sam (Accessibility-Dependent User).** Primary CTA text at 2.15:1 — cannot read `Sign in`, `Log in`, or `Create Room` in dark mode. Room chips at 11px and the `Live` badge at 10px. Statistics labels at 12px, `#75798c` on `#1a1c2a` = 3.92:1, failing AA for normal-weight text. Hits **two `<h2>` elements both reading "Filters"** in the heading outline, because `HomeFilters.tsx` renders the desktop fields and the always-in-DOM modal sheet with the same heading. Focus ring is a solid 3px `color-mix` outline — that part is good.

**The Anonymous Lurker (project-specific; PRODUCT.md permits full browsing without an account).** This is the persona the product explicitly courts, and the page serves them well in copy: the explainer under the counter tells them exactly what signing in buys, and cards say `Sign in to join` rather than pretending the door is open. But they meet three sign-in prompts before their first room, and on mobile they never see a room at all before deciding whether to stay.

## Minor Observations

- `HomeFilters.tsx:22` — `${facets.categories.length} categories and ${facets.tags.length} tags available.` never pluralizes. Live page reads `1 categories 1 tags available.`
- `HomePage.tsx:91-92` — `<CreateRoomDialog>` is indented two spaces short of its siblings.
- `HomeSectionBoundary.tsx:54` renders `{children}` *underneath* the failure message and Retry button, so a failed section shows an error and its stale content simultaneously.
- `LiveRooms.tsx:131` — `order holds until you refresh` explains an implementation detail (`reconcileRoomPresentation` keeps position stable) in the user's voice. It reassures nobody who didn't already know the list could reshuffle.
- The featured room card renders 1345px wide at a 1512px viewport. DESIGN.md caps the center at 1040px; `.home-main`'s `max-width` at `app.css:3218` is not clamping.
- `PastStreams.tsx` formats the tooltip in UTC (`timeZone: 'UTC'`) while the relative label is local-derived — "2 hours ago" with a tooltip in a timezone the reader doesn't live in.
- `EmptyDiscovery` renders `— N accounts are connected and watching this page`, duplicating the number already showing 400px above in the counter.

## Questions to Consider

- ADR 0096 is Accepted and describes a product that no longer exists. Which is the real BhayanakCast — the cobalt clubhouse in the docs, or the violet one on screen? One of them has to go.
- What if a phone's first screen were the counter and one room card, and everything else — search, filters, statistics — came after? What does a visitor actually need before they've seen a single room?
- Three sign-in buttons is a symptom. What is the page uncertain about — where sign-in belongs, or whether anonymous browsing is really a first-class state?
- `Live` is the most consequential word on a room card and it renders at 10px. What would this page look like if importance and type size agreed?
