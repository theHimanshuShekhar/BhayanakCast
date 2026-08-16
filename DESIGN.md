---
name: BhayanakCast
description: A terminal-club community for discovering, joining, and watching small social screen-sharing rooms.
colors:
  canvas: "#0b0e14"
  canvas-light: "#f2f4f8"
  surface: "#141924"
  surface-light: "#ffffff"
  surface-subtle: "#0f141d"
  surface-subtle-light: "#e9edf4"
  surface-raised: "#1b2130"
  surface-raised-light: "#ffffff"
  rail: "#0f141d"
  rail-light: "#e9edf4"
  ink: "#e6eaf3"
  ink-light: "#131722"
  ink-secondary: "#a5b0c4"
  ink-secondary-light: "#4c586e"
  ink-muted: "#8b96ab"
  ink-muted-light: "#59657c"
  ink-faint: "#7e899b"
  ink-faint-light: "#59657c"
  border: "#232b3a"
  border-light: "#dbe1ec"
  border-strong: "#5c6b8b"
  border-strong-light: "#7b889f"
  action: "#c084fc"
  action-light: "#7326d9"
  action-hover: "#d9b3ff"
  action-hover-light: "#5c17b8"
  action-soft: "#2a1f47"
  action-soft-light: "#eee6ff"
  action-line: "#c084fc"
  action-line-light: "#7326d9"
  action-ink: "#150b26"
  action-ink-light: "#ffffff"
  live: "#ff5f8f"
  live-light: "#c62a5e"
  host: "#4ade80"
  host-light: "#0d7a4f"
  warning: "#fbbf24"
  warning-light: "#8a5a00"
  danger: "#ff7a63"
  danger-light: "#bc422a"
  private: "#22d3ee"
  private-light: "#0e7490"
  scrim: "rgb(5 7 11 / 0.86)"
  scrim-light: "rgb(19 23 34 / 0.72)"
  media-canvas: "#05070b"
  media-canvas-edge: "#2a1f47"
  media-scrim: "rgb(5 7 11 / 0.88)"
  on-media-ink: "#e6eaf3"
  on-media-live: "#ff5f8f"
  on-media-warning: "#fbbf24"
  on-media-danger: "#ff7a63"
  on-media-private: "#22d3ee"
  avatar-azure: "#7ac3ff"
  avatar-orchid: "#ed9ee5"
  avatar-gold: "#fea668"
  avatar-lime: "#b3ca65"
  avatar-teal: "#37d8c9"
  avatar-periwinkle: "#a5b6ff"
  avatar-ink: "#0b0e14"
typography:
  display:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  card:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "1rem"
    fontWeight: 450
    lineHeight: 1.5
    letterSpacing: "0"
  meta:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
  eyebrow:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
    textTransform: "uppercase"
  count:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0"
    fontFeature: "tabular-nums"
rounded:
  chip: "0.3125rem"
  control: "0.5rem"
  card: "0.75rem"
  pill: "9999px"
spacing:
  hair: "0.25rem"
  tight: "0.375rem"
  snug: "0.5rem"
  cozy: "0.625rem"
  base: "0.75rem"
  roomy: "1rem"
  section: "1.5rem"
  band: "2.125rem"
  gutter: "2.5rem"
components:
  button-invite:
    backgroundColor: "transparent"
    textColor: "{colors.action}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "0 1.125rem"
    height: "2.75rem"
  button-commit:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
    height: "2.75rem"
  button-quiet:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
    height: "2.75rem"
  button-leave:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "0 1.125rem"
    height: "2.5rem"
  chip-state:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 0.5625rem"
    height: "1.625rem"
  chip-filter-active:
    backgroundColor: "{colors.action-soft}"
    textColor: "{colors.action}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.5rem 0.25rem 0.75rem"
    height: "2.25rem"
  input-search:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2.75rem"
  card-room:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.card}"
    rounded: "{rounded.card}"
    padding: "1rem 1rem 1.125rem"
  card-room-featured:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
    rounded: "{rounded.card}"
    padding: "1rem 1rem 1.125rem"
  nav-rail-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0.375rem 0.5rem"
    height: "3.5rem"
    width: "4.5rem"
---

# Design System: BhayanakCast

## Overview

**Creative North Star: "The Terminal Clubhouse"**

BhayanakCast is a public community clubhouse, not a broadcast studio or an operations console. Every surface frames something live: a room preview, a person sharing, a conversation, or a state changing now. The interface borrows the legibility and social shorthand of a terminal client—monospace text, hairline panels, compact status words, dotted dividers—without becoming nostalgic decoration.

Dark is the canonical world: near-black slate grounds with one violet identity glaze. Light is an intentional daylight counterpart, not an inversion. Both preserve the same hierarchy, geometry, state vocabulary, and contrast. Violet means identity, navigation, selection, or action only. Rose-red means Live, green means Host or success, amber means warning, coral-red means danger, and cyan means private. Colour always accompanies a word, icon, or structural cue.

Product truth outranks styling. Capacity, privacy, host authority, stream availability, watch state, pending/failed chat, and moderation capability remain explicit and keyboard reachable. User content is never uppercased, truncated into meaninglessness, or recoloured as state. Reduced motion removes transforms and pulses while preserving visible confirmation.

**Key Characteristics:**

- JetBrains Mono across display, UI, chat, counts, and metadata.
- Dark-canonical slate and an intentional daylight counterpart.
- One violet identity/action glaze plus five non-overlapping semantic families.
- Pill status language, hairline object boundaries, and dotted internal dividers.
- Real media and live social state supply the visual energy.
- Accepted Home and Room geometry remains structurally unchanged.

## Colors

The palette has four surface depths, two hairlines, one violet glaze, and five semantic families. Frontmatter values are normative and map directly to `src/styles/app.css`: un-suffixed tokens are the dark `:root` values; `-light` tokens are `[data-theme="light"]` overrides.

- **Canvas and rail:** Canvas is the page ground. Rail and subtle surface define navigation and recessed slots. Raised surface is reserved for selected controls, dialog panels, and hierarchy—not generic card decoration.
- **Ink:** Primary ink carries headings and body. Secondary carries descriptions. Muted and faint carry metadata; light mode intentionally shares one AA-safe low-emphasis value for both.
- **Boundaries:** `border` is a quiet structural hairline. `border-strong` is the required-control boundary and clears WCAG 2.2's 3:1 non-text contrast floor in both themes.
- **Violet action:** Action, hover, soft wash, line, and action ink are one family. Never use violet to mean Live, Host, warning, danger, or private.
- **Semantic families:** Live uses rose-red, Host/success green, warning amber, danger coral-red, and private cyan. A status word remains present; Live may add a same-family leading dot.
- **Media:** Media canvas, scrim, and `on-media-*` values are theme-invariant because captured frames control the background. Never substitute daylight semantic values over media.
- **Avatar identity:** Six light tints carry dark avatar ink in both themes. The tint is deterministically keyed to the account id and is decorative identity, never state.

No gradients, glows, or ambient colour clouds. Warmth comes from live previews, people, and conversation—not ornamental effects.

**The One Violet Rule.** Violet means identity, navigation, selection, or action—nothing else.

**The Real State Rule.** Colour accompanies a word, icon, or structural cue and never carries state alone.

## Typography

JetBrains Mono is self-hosted from `public/fonts/jetbrains-mono-latin.woff2` with a 100–800 variable axis and `font-display: swap`. It is the only family across display, UI, chat, counts, and metadata. Use the monospace fallback stack in frontmatter; never add a second display face.

The fixed size ladder is 13, 14, 16, 18, 24, 30, and 36px. There is no 20px or 32px exception.

- **700:** page/section/card titles, eyebrows, status words, and changing counts.
- **600:** buttons, interactive labels, tags, and compact chips.
- **450:** body, room descriptions, and chat messages.
- **400:** timestamps and muted metadata.

Tracking compensates for one fixed-width family: `-0.03em` at 36/30px, `-0.02em` at 24px, `-0.01em` at 18px, zero at 16/14px and ordinary 13px labels, and `+0.08em` only for uppercase 13px eyebrows. Use tabular numerals for live counts, capacities, timers, timestamps, and metrics. Lowercase is reserved for fixed chrome labels; never transform user-provided names or content.

**The Fixed Ladder Rule.** All interface type uses 13, 14, 16, 18, 24, 30, or 36px.

## Layout

Preserve the accepted product geometry. The spacing base is 4px. Breakpoints are 48rem, 80rem, and 100rem.

Home has three stages:

- **Below 768px:** one document-flow column with 16px inline gutters, a compact top brand bar, and labeled Home/Create/Profile bottom navigation.
- **768–1279px:** a 72px icon rail plus a fluid discovery column with 40px inline gutters.
- **1280px and above:** the same rail, a fluid centre, and a 280px identity/utility rail; the centre is capped so wide viewports return surplus space as margin instead of stretching content.

Live Rooms keep rank order: rank one is featured, ranks two and three form the right stack on wide screens, and later rooms continue in a two-column grid. Medium screens use a full-width feature plus two columns; mobile uses one column. Past Streams are compact metadata blocks—one column on mobile, two on desktop—with real media only when a real archived capture exists.

The admitted desktop room is a fixed-viewport media workspace: 72px app rail, compact room header, dark media canvas, control shelf, and a 360px Chat/People/Activity dock at 1280px and above. At 768–1279px companions are a non-modal right drawer. Mobile uses a compact header, two-column overview when unwatched, a primary watched stage with a horizontal tile strip, and explicit 55%/90% companion sheets above the room bar.

Density adapts by surface. Discovery stays breathable. Room people, chat, activity, and controls become compact enough to preserve live social state. Do not introduce nested discovery scroll regions or a rail that cannot fit beside the documented stage.

## Elevation & Depth

Structure comes from hairlines, not shadows. Card interiors use dotted dividers. Controls use solid strong hairlines where their boundary must remain perceivable. A surface is never violet merely because it is important.

Dark elevation uses a tight near-black drop and surface lightness. Light elevation uses a restrained ink shadow. The canonical shadow strings live in `.impeccable/design.json` because frontmatter has no shadow token group. Hover may recolour a card's one-pixel ring to the action line; shadows never communicate semantic state.

Five z-layers are fixed: content `0`, sticky `20`, navigation `30`, overlay `40`, dialog `50`. Avoid arbitrary z-index values.

Motion uses `cubic-bezier(0.2, 0.8, 0.2, 1)`: 120ms for control and colour feedback, 180ms for menus/popovers/sheets, and 240ms for layout/state transitions. The Live dot is the only looping animation, an opacity pulse at 1.8s. Reduced motion removes pulses and transforms and makes state changes immediate.

**The Hairline Rule.** Solid hairlines bound controls; dotted hairlines divide card and row internals.

## Shapes

Four radii, four roles:

- **5px chip:** compact on-media labels where full pill geometry would waste space.
- **8px control:** buttons, fields, rail items, fact blocks, and quiet actions.
- **12px card:** room cards, substantial panels, dialogs, media tiles, and companion sheets.
- **Full pill:** status words, neutral tags, counts, avatars, filter chips, and presence dots.

Cards and panels use 12px, not a fifth radius. Media clips to its card radius and letterboxes real frames into the media canvas rather than cropping them. Avatar fallbacks are two uppercase alphanumeric characters in a pill disc with a deterministic account tint. Borders are one pixel and either solid for an object boundary or dotted for an internal terminal-club separator.

## Components

### Buttons

Four weights express intent without changing layout:

- **Invite:** transparent with violet outline/ink; used for Create, Join, and sign-in invitations.
- **Commit:** violet fill with action ink; used for Watch, confirm, Save, and the primary dialog action.
- **Quiet:** raised surface, strong hairline, primary ink; used for Mute, Fullscreen, Settings, Cancel, and secondary navigation.
- **Leave/danger:** transparent with danger outline/ink; used only for destructive actions.

Buttons use 600 weight and visible focus. Hover changes family-appropriate fill or ink; disabled and busy semantics remain explicit. Do not make every room control violet.

### Status pills and tags

A status pill is a 1.625rem full pill with 13px/700 text, a 45% semantic-family hairline, and a 10% family wash. Live adds a leading dot. Neutral category/tag chips are transparent with `border-strong`, muted ink, and 13px/600 text. Filter chips are the genuinely interactive pill variant and may use the violet soft/action pair.

### Fields

Inputs, selects, and textareas are recessed slots on subtle surface with a strong hairline, 8px radius, 16px/450 values, and a violet focus boundary plus the shared visible focus ring. Placeholders use secondary ink at full opacity. Radio and checkbox controls use the action accent without inheriting text-field geometry.

### Room card

A room card is a 12px terminal panel: one real preview when available, title at 18px/700 (30px/700 only for the featured card), neutral tags, semantic status pills, and a dotted separator before metadata/open cue. It does not become a floating glass tile. Long names and tags wrap rather than clip.

### Member tile and chat row

A member tile names the person and capability state before decoration. Its footer is divided by a dotted hairline. The avatar is a real image or the shared deterministic fallback. Chat rows use a 2rem avatar, 700 author name, optional 13px/400 canonical timestamp, body at 16px/450, and a Host status pill derived from existing roster authority. Pending/failed local messages do not invent canonical timestamps and retain Retry/Discard.

### Navigation

The current rail item is a raised 8px control with violet ink; inactive items remain transparent with secondary ink. The mobile bottom navigation is labeled and uses the same action family for current state. Theme and sign-in controls use quiet/invite geometry rather than icon-only novelty.

## Do's and Don'ts

### Do

- **Do** use one violet family for identity, navigation, selection, and action.
- **Do** pair semantic colour with a word, icon, or structural cue.
- **Do** keep dark and light intentional, equivalent, and AA-safe.
- **Do** use JetBrains Mono everywhere and weight to create hierarchy.
- **Do** keep all type on the 13/14/16/18/24/30/36px ladder.
- **Do** use dotted hairlines inside cards and rows; solid hairlines around controls.
- **Do** show real media when available and let it carry the visual energy.
- **Do** keep focus, reduced motion, pending/failed states, and moderation actions explicit.
- **Do** preserve Home and Room composition, responsive stages, and product copy.

### Don't

- **Don't** reuse violet for Live, Host, warning, danger, or private.
- **Don't** use colour alone to communicate state.
- **Don't** add gradients, glows, glassmorphism, ambient blobs, or ornamental terminal glyphs.
- **Don't** add a second font, off-ramp type size, or weight outside 400–700 for interface text.
- **Don't** uppercase user names, room names, messages, categories, or tags.
- **Don't** round cards into pills or invent a fifth radius.
- **Don't** hide critical actions behind hover-only affordances.
- **Don't** fabricate thumbnails, participants, timestamps, or social proof.
- **Don't** change accepted layouts to make the visual system feel more dramatic.
