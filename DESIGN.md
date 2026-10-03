---
name: BhayanakCast
description: Your crew. Your screens. One room.
colors:
  on-air-glow: "oklch(0.68 0.19 265)"
  on-air-glow-soft: "oklch(0.68 0.19 265 / 0.18)"
  on-air-glow-halo: "oklch(0.68 0.19 265 / 0.55)"
  on-air-glow-ink: "oklch(0.2 0.04 265)"
  tally-light-red: "oklch(0.72 0.22 25)"
  tally-light-red-ink: "oklch(0.98 0.02 25)"
  signal-green: "oklch(0.78 0.18 150)"
  standby-amber: "oklch(0.8 0.17 70)"
  midnight-ink: "oklch(0.17 0.025 265)"
  deep-slate: "oklch(0.2 0.028 265)"
  slate-panel: "oklch(0.255 0.03 265)"
  lifted-slate: "oklch(0.305 0.032 265)"
  lifted-slate-high: "oklch(0.355 0.034 265)"
  screen-well: "oklch(0.14 0.02 260)"
  readout-white: "oklch(0.98 0.005 260)"
  readout-dim: "oklch(0.82 0.01 260)"
  readout-muted: "oklch(0.72 0.012 260)"
  readout-faint: "oklch(0.68 0.012 260)"
  hairline-subtle: "oklch(1 0 0 / 0.09)"
  hairline: "oklch(1 0 0 / 0.14)"
  hairline-strong: "oklch(1 0 0 / 0.21)"
typography:
  display:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.01em"
  body-small:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.01em"
  label:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.12em"
  chip:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "18px"
  rail: "10px"
  full: "9999px"
spacing:
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "2.5": "10px"
  "3": "12px"
  "3.5": "14px"
  "4": "16px"
components:
  button-default:
    backgroundColor: "{colors.slate-panel}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.sm}"
    typography: "{typography.body-small}"
    height: "34px"
    padding: "0 14px"
  button-default-hover:
    backgroundColor: "{colors.lifted-slate}"
  button-primary:
    backgroundColor: "{colors.on-air-glow}"
    textColor: "{colors.on-air-glow-ink}"
    rounded: "{rounded.sm}"
    height: "34px"
    padding: "0 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.sm}"
    height: "34px"
    padding: "0 14px"
  button-ghost-hover:
    backgroundColor: "{colors.lifted-slate}"
  button-danger:
    textColor: "{colors.tally-light-red-ink}"
    rounded: "{rounded.sm}"
    height: "34px"
    padding: "0 14px"
  button-small:
    height: "28px"
    padding: "0 10px"
  icon-button:
    textColor: "{colors.readout-dim}"
    rounded: "{rounded.sm}"
    size: "32px"
  chip-default:
    backgroundColor: "{colors.lifted-slate}"
    textColor: "{colors.readout-dim}"
    rounded: "{rounded.full}"
    typography: "{typography.chip}"
    padding: "3px 8px"
  chip-live-solid:
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    typography: "{typography.chip}"
    padding: "3px 8px"
  chip-accent:
    backgroundColor: "{colors.on-air-glow}"
    textColor: "{colors.on-air-glow-ink}"
    rounded: "{rounded.full}"
    padding: "3px 8px"
  input-field:
    backgroundColor: "{colors.deep-slate}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  card:
    backgroundColor: "{colors.slate-panel}"
    rounded: "{rounded.md}"
    padding: "14px"
  rail-item:
    textColor: "{colors.readout-muted}"
    rounded: "{rounded.rail}"
    size: "40px"
  rail-item-active:
    backgroundColor: "{colors.on-air-glow-soft}"
    textColor: "{colors.on-air-glow}"
  segmented-control:
    backgroundColor: "{colors.deep-slate}"
    rounded: "{rounded.sm}"
    padding: "3px"
---

# Design System: BhayanakCast

## Overview

**Creative North Star: "The Late-Night Control Room"**

BhayanakCast looks like a broadcast booth after midnight. The lights are down, everything is set in one monospace face, and the only color comes from the signals that matter: red tally lights on whoever is live, an accent glow on what you've selected or what is you, and a green dot for "streaming" or "online". The room is dark by default (`theme: dark`). Surfaces are near-black panels tinted blue-violet, and depth comes from tonal steps plus a thin lit top edge. Heavy drop shadows aren't used.

The system is dense and reads like instruments. Readouts use tabular numbers, and small uppercase labels are tracked wide (0.12em). Streams sit in dark screen wells inside panels, which makes the screens themselves the brightest things on the page. The copy is lowercase and casual ("nobody's sharing yet", "say something…", "leave"). The feel should be a control room for friends, not an ops dashboard.

Appearance can be tuned per user: accent hue (six presets, any 0–360), corner radius (0–32px, with `sm`/`lg` derived from it), tile density, room layout, and light or dark theme. Every rule below has to survive those settings. Treat the accent as a role, not a hue, and never hard-code a radius where a radius token exists.

It rejects two looks: corporate meeting UI (SaaS blue, polite white-glove chrome) and esports streamer neon (glow on everything, angular gamer chrome, gradient overload). Glow is a signal. It is not decoration.

**Key Characteristics:**
- One typeface, JetBrains Mono, carries every role from 32px stat numbers to 6px avatar initials.
- Dark by default, with blue-violet-tinted neutrals stepped in small oklch lightness increments.
- Color is reserved for state: live (red), selected or self (accent), healthy (green), caution (amber).
- Tactile, lit surfaces: an inset top highlight and a shadow underneath. Primary and active elements get a glow.
- Small, dense type (13px body, 10–11.5px labels) with tabular numbers for every count.

## Colors

The palette is a dark tonal ladder carrying three signal colors, and each signal means exactly one thing. Every token is authored in oklch, and the frontmatter lists the dark-theme values (the default). Light theme swaps the neutrals and ink tokens in `src/styles/app.css`. The signal hues stay the same in both themes.

### Primary
- **On-Air Glow** (`on-air-glow`, default hue 265, violet): the accent is a role, and the user retunes its hue at runtime through `--accent-h`. It marks the active rail item, primary buttons, speaking waves, focus rings, @mentions and the viewer's own identity. It has three companions: **soft** (18% alpha) for active fills and focus halos, **halo** (55% alpha) for glows, and **ink** (a dark ink tinted with the same hue) for text on the accent. The ink is dark because near-white on an L 0.68 fill stays under 3:1 at every hue, while dark ink gives about 6:1 at every hue.

### Secondary
- **Tally Light Red** (`tally-light-red`): means live and nothing else. It's used for LIVE chips, the pulsing live dot, and live-room tile outlines. Mixed down with surface, it also serves as the danger button, where "leave" and "stop" read as cutting the feed. The solid LIVE chip mixes 72% red with 28% black behind white text, which keeps 10.5px white text above 4.5:1. Your own active share uses the same solid red: it's the one control that means you're on air.

### Tertiary
- **Signal Green** (`signal-green`): means healthy and present. It appears on "Streaming" status, the online dot, capacity chips and ok chips.
- **Standby Amber** (`standby-amber`): caution states. Use it sparingly.

### Neutral
- **Midnight Ink** (`midnight-ink`): the page background. It's the darkest layer, apart from screen wells.
- **Deep Slate** (`deep-slate`): canvas for the side rail, input wells and segmented-control tracks.
- **Slate Panel** (`slate-panel`): cards, tiles and default buttons.
- **Lifted Slate** / **Lifted Slate High** (`lifted-slate`, `lifted-slate-high`): hover fills, default chips, active segments and tooltips.
- **Screen Well** (`screen-well`): the fixed near-black behind stream mosaics. It doesn't change with theme, because screens always sit in the dark.
- **Readout White → Faint** (`readout-white`, `readout-dim`, `readout-muted`, `readout-faint`): a four-step text ladder for primary text, secondary text, labels and metadata, and timestamps and other metadata. Every step clears 4.5:1 on every panel up to Lifted Slate (faint, the dimmest, at 4.7:1), in both themes: `src/styles/contrast.test.ts` fails if a token drops under. Text in the accent uses `--color-primary-strong`, not `--color-primary`: the accent fill is under 3:1 on the light theme's panels.
- **Hairlines** (`hairline-subtle`, `hairline`, `hairline-strong`): white borders at 9%, 14% and 21% alpha (black at 8%, 14% and 22% in light theme). Dashed subtle hairlines divide card footers and chat system lines.

### Named Rules
**The Tally Rule.** Red means someone is live. Don't use it for decoration, emphasis or brand. The one allowed crossover is destructive "leave/stop" actions, and those use the muted mix, never the solid chip.

**The Role-Not-Hue Rule.** Always reference the accent through `--color-primary*` tokens. A hard-coded violet breaks the first time a user picks lime.

## Typography

**Display Font:** JetBrains Mono Variable (with JetBrains Mono, ui-monospace, Menlo, monospace)
**Body Font:** the same
**Label/Mono Font:** the same

**Character:** One monospace face does everything. It reads as a terminal, a broadcast readout and a chat log at once. Hierarchy comes from weight (400 → 800), size and tracking, never from a second family.

### Hierarchy
- **Display** (800, 32px, line-height 1, -0.02em): big stat numbers on profiles and admin stat tiles.
- **Headline** (800, 22px on mobile → 26–28px, -0.02em): page titles such as the Active Rooms heading on home (20→24px), room recaps and profile names.
- **Title** (700, 14–15px, -0.005em): section heads, which always carry a 6px status dot. Room card names use this weight too.
- **Body** (400, 13px, 1.45, 0.01em): the base size, set on `body`. Chat and most UI text use it.
- **Body small** (400, 11–12.5px): buttons (12px md, 11.5px sm), form fields (12.5px), metadata and toggle descriptions.
- **Label** (500, 10px, uppercase, 0.12em): section subtitles, stat labels and field labels (11px, 0.06em). Chips use 10.5px at 0.06em.

### Named Rules
**The Ten Pixel Floor Rule.** Readable text is never smaller than 10px. The one exception is avatar initials, which are a glyph mark that always sits next to the person's name.

**The Lowercase Action Rule.** Headings and nav labels use Title Case ("Active Rooms", "Start a Room"). Actions and copy use lowercase, in the room's voice ("start a room", "sign in with discord", "leave", "try again").

**The One Face Rule.** JetBrains Mono is the only typeface. Never introduce a sans or serif pairing.

**The Tabular Readout Rule.** Every count, duration and capacity (9/10, 1h 42m, +5) uses `tabular-nums`, so numbers stay put while they update live.

## Layout

The app shell is a 64px icon rail on the left, a scrolling main column, and an optional right sidebar (home stats, room chat/people/feed tabs). The body never scrolls (`overflow: hidden`). Individual panes scroll instead.

- **Room grid:** 12 columns on desktop and 2 columns below `md`. Density is a user setting: compact (8px gap, 10px padding, 120px rows), comfortable (12px, 16px, 140px rows) or spacious (18px, 22px, 180px rows). Layout presets are mosaic, grid and spotlight.
- **Stream mosaic** (room cards): always 16:9. One stream fills it, two split side by side, and three use one hero tile plus a stack of two. Tiles have 2px gaps.
- **Spacing rhythm:** a 4px base with lots of half steps (6, 10 and 14px). Gaps of 8–12px and card padding of 14px dominate.
- **Home header:** the page title sits on the left and, for signed-in users, a primary "start a room" button on the right (full width below the title on phones). Visitors have no start button: the visitor intro, above search at every width, is their one way in. Filling Up appears only once there are more than four live rooms; with fewer, it would repeat cards that are already in view.
- **Room stage:** screens first. The screen zone holds every share in the room-card mosaic: one fills it, two split it, three are a hero plus a stack. The "grid" layout makes them equal, and "spotlight" keeps a wide hero with a narrow column. The hero is the pinned share, else whoever had the big slot first, so a new share never moves an existing one. Cameras sit in a row below the screens, or take the stage when nobody shares. Everyone else, you included, is a compact chip. The density setting sets the gaps and the camera row's height. On phones the zones stack and each screen keeps 16:9. The header's "viewers" toggle hides cameras and chips.
- **Responsive:** below `sm` the rail becomes a bottom bar that respects the safe-area inset. Its targets are 44px, and it has no accent swatch, because accent lives in settings. The room sidebar becomes a drawer, and rail tooltips are hidden. On a room page the bottom bar is hidden, because the room's control bar takes the bottom. Screen sharing controls are hidden on mobile (see PRODUCT.md).

## Elevation & Depth

The system is a hybrid: tonal layering does most of the work, and a lit bevel adds tactility. Every raised surface has a 1px inset highlight on its top edge, plus a small shadow below. In dark theme, a 1px inset dark line on the bottom edge completes the bevel. Glow, meaning an accent-colored blur with no offset, marks what is selected, primary or speaking. It never signals elevation.

### Shadow Vocabulary
- **Card** (`--shadow-card`): the resting state of cards, default buttons and active segments.
- **Pop** (`--shadow-pop`): tooltips, menus and popovers.
- **Deep** (`--shadow-deep`): dialogs.
- **Glow** (`--shadow-glow`, `0 0 24px var(--color-primary-glow)`): accent emphasis. Variants include the primary button's 6px/20px underglow, the active rail item's 16px glow with a 1px accent ring, and status dots' 6–8px glows.

### Named Rules
**The Lit Edge Rule.** Raised surfaces are beveled, not floated. Use the shadow tokens, which already include the inset highlight, and don't write a bare `box-shadow: 0 4px …` drop shadow.

**The Glow Means Signal Rule.** Glow appears only on the accent (selection, primary action, speaking, self) and on status dots. A card that glows is shouting.

## Shapes

The shapes are soft rectangles, with corners that follow the user's radius setting (default 12px). `--radius-sm` is the radius minus 6 (minimum 4) and is used for buttons, inputs, mosaics and icon buttons. `--radius` (12px) is for cards and tiles. `--radius-lg` is the radius plus 6, for large containers. The rail uses a fixed 10px, and chips, avatars, status dots and scrollbar thumbs are fully round. Borders are 1px hairlines. Card footers and screen-kind labels use dashed hairlines, which gives a quiet "schematic" detail.

## Components

### Buttons
Buttons are tactile and quiet, and they press down on click (`active:translate-y-px`, 120ms transitions).
- **Shape:** gently rounded (`--radius-sm`, 8px by default). Heights are 34px (md) and 28px (sm), weight 500.
- **Default:** Slate Panel fill, hairline border and card bevel. Hover lifts to Lifted Slate with a strong hairline.
- **Primary:** On-Air Glow fill with dark ink text, weight 600, and its own bevel plus an accent underglow. Hover is `brightness(1.1)`. Use at most one per view.
- **Ghost:** transparent. Hover fills with Lifted Slate.
- **Danger:** Tally Light Red mixed 18% into surface, with a 45% red border and live-ink text.
- **Disabled:** 50% opacity with a not-allowed cursor.
- **Icon button:** 32px square in Readout Dim. Hover gets a Lifted Slate fill and full-white text.

### Chips
- **Style:** full pill, 10.5px at 0.06em, 3px/8px padding, 1px border. An optional 6px dot comes first.
- **Variants:** default (Lifted Slate), live (22% red wash, 55% red border, red dot with glow and pulse), live solid (the LIVE badge: dark red with a white pulsing dot), accent (solid On-Air Glow, used for role badges like HOST) and ok (22% green wash).

### Cards / Containers
- **Corner Style:** `--radius` (12px).
- **Background:** Slate Panel, with a 1px hairline border.
- **Shadow Strategy:** card bevel (see Elevation).
- **Internal Padding:** 14px with 10px internal gaps. The footer is set off by a dashed subtle hairline.

### Inputs / Fields
- **Style:** Deep Slate well, 1px hairline, `--radius-sm`, 10px/12px padding, 12.5px text. Labels are 11px uppercase at 0.06em in Readout Muted.
- **Focus:** the border shifts to On-Air Glow, with a 3px soft accent halo. The global focus-visible style is a 2px accent outline with a 2px offset.

### Navigation
- **Style:** a 64px icon rail on Deep Slate, containing a "BC" monogram tile, 40px rail items with 16px stroke icons, a live online count, and at the bottom the accent swatch, theme toggle and avatar menu.
- **States:** idle items are Readout Muted, and hover gives a Slate Panel fill. Active items get a soft accent fill, accent icon, 1px accent ring and 16px glow, plus a 3px glowing accent bar on the rail's left edge. Tooltips (Lifted Slate High, pop shadow) slide in 4px from the right on hover or focus.
- **Mobile:** the rail becomes a bottom bar, and the active bar and tooltips are hidden.

### Stream Tile (signature)
Stream tiles are the product's main surface. Each is a dark screen well containing the live `<video>` (letterboxed, never cropped), or a hue-tinted striped placeholder until the picture arrives. Overlays sit on top: a solid LIVE chip and role chip at top left, the per-person controls at top right, and a name pill at bottom left (black at 55% with 8px blur) with a speaking wave. The streamer's camera sits bottom right as a picture-in-picture. A speaking person gets a 2px accent ring with a glow, and a sharing tile a red-tinted outline.
- **Per-person controls:** pin, mute for me, their voice volume (mic icon), their screen's volume (screen icon), fullscreen and the moderation menu. Each control's name includes the person ("Pin bo", "Mute for me: bo"). Both sliders are white: the icon tells them apart, not a colour.
- **Chip:** someone with neither a share nor a camera is a 40px pill with their avatar, name, role and mic state. The border lights in the accent while they speak.

### Control Bar
Round 40px controls in a pill. Lit in the accent when on (camera, mic, the open chat drawer), plain when off, where the slashed icon carries the state. Your own share is solid live red and reads "live · stop". Leave uses the danger mix, never solid red. Every control has a tooltip, and a "skip to controls" link jumps past the tiles.

### Moderation
Stop a share, change a role or kick, from the ⋯ menu on a tile or on a row in the people tab. A kick is permanent for the room, so it always asks first. The dialog names the person and says they can't rejoin. Its buttons are "keep them" and a danger "kick {name}".

### Screen Switch-On (signature motion)
"On air": when a share starts, its screen switches on like a monitor. It opens from a bright horizontal line to the full frame (clip-path from `inset(49.5% 0)` to `inset(0)`, with brightness 2.4 → 1 and saturation 0 → 1) over 520ms on `cubic-bezier(0.16, 1, 0.3, 1)`, and the LIVE chip lights 260ms later (`animate-bc-power-on`). On home, only a room that goes live while the page is open switches on. The first render never does. This is the product's one authored moment, so don't reuse it for anything else.

### Motion
- **Settle-in** (`animate-bc-enter`, 220ms): new tiles, chat lines and lit chips arrive with opacity plus a 4px rise.
- **Dialogs:** fade and scale from 0.98 over 200ms (they slide up on phones) and exit in 120ms.
- **Stage:** when shares come and go, the screen zone eases its grid tracks over 300ms, so existing screens slide to make room instead of jumping.
- **Feedback:** hover and press run 120–160ms. The speaking ring eases over 200ms.
- **Reduced motion:** no pulse or wave loops, and the switch-on and settle-in become a 200ms fade. Reactions fade in place, and hover lifts and dialog movement are `motion-safe:` only.

### Speaking Wave
Five 2px accent bars animate their height between 3px and 12px (`bc-wave`, 1.2s, staggered by 0.1s). At 30% opacity it means muted. It's the only way the UI shows who is talking.

## Do's and Don'ts

### Do:
- **Do** reference color through tokens (`bg-primary`, `text-live-ink`, `border-border`) so theme and accent hue changes apply everywhere.
- **Do** use `tabular-nums` for every live count, capacity and duration.
- **Do** mark section heads with a 6px status dot (primary, live, livePulse, success or muted) that matches what the section contains.
- **Do** keep screens in the dark Screen Well (`oklch(0.14 0.02 260)`) regardless of theme.
- **Do** use `--radius-sm` or `--radius` rather than fixed pixel radii, so the user's radius setting applies.
- **Do** write UI copy in lowercase and casual, matching the room's voice ("nobody's sharing yet", "leave").
- **Do** give every animation a `prefers-reduced-motion` path that keeps the state change visible (a fade), and gate spatial movement with `motion-safe:`.

### Don't:
- **Don't** use Tally Light Red for anything except live state and destructive feed-cutting actions.
- **Don't** introduce a second typeface. JetBrains Mono is the whole type system.
- **Don't** make it look like corporate meeting software: no SaaS blue, no white-glove chrome, no stock-photo friendliness.
- **Don't** drift into esports streamer neon: no glow on non-signal elements, no angular gamer chrome, no gradient overload.
- **Don't** add bare offset drop shadows. Use `--shadow-card`, `--shadow-pop` or `--shadow-deep`, which carry the lit edge.
- **Don't** hard-code the violet hue. The accent is whatever the user picked.
- **Don't** set text on the accent in white or near-white. Use `text-primary-ink`.
- **Don't** add page-load choreography. Motion marks something changing, and the switch-on is saved for going live.
