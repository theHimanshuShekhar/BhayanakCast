---
name: BhayanakCast
description: Dense live-room product UI for public discovery, screen streams, profiles, and moderation.
colors:
  void-deck: "#080d18"
  rail-night: "#0b1220"
  panel-navy: "#101725"
  raised-panel: "#151d2e"
  stream-violet: "oklch(0.68 0.19 265)"
  stream-violet-soft: "oklch(0.68 0.19 265 / 0.18)"
  stream-violet-glow: "oklch(0.68 0.19 265 / 0.55)"
  live-coral: "oklch(0.72 0.22 25)"
  host-green: "oklch(0.78 0.18 150)"
  warning-amber: "oklch(0.8 0.17 70)"
  text-primary: "#f8fafc"
  text-secondary: "#cbd5e1"
  text-muted: "#94a3b8"
  text-faint: "#64748b"
  line-soft: "rgba(255, 255, 255, 0.10)"
  line-strong: "rgba(255, 255, 255, 0.20)"
typography:
  display:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "1.5rem"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "1rem"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.01em"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "0.68rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  panel: "20px"
components:
  button-primary:
    backgroundColor: "{colors.stream-violet}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.label}"
  input-search:
    backgroundColor: "{colors.panel-navy}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "0 12px 0 44px"
    height: "44px"
    typography: "{typography.body}"
  room-panel:
    backgroundColor: "{colors.raised-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "16px"
  status-chip-live:
    backgroundColor: "oklch(0.72 0.22 25 / 0.18)"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "22px"
    typography: "{typography.label}"
---

# Design System: BhayanakCast

## 1. Overview

**Creative North Star: "Live Signal Deck"**

BhayanakCast is a compact live-room product UI, not a marketing surface. It should feel like a signal-rich operations deck for public discovery, active streams, room membership, and platform moderation: dark, dense, immediate, and legible under motion. The mono-forward typography, narrow rail, violet signal glow, live coral status, and slate-navy panels are identity, not decoration.

The system rejects generic SaaS polish, cream dashboards, gradient-text hero treatments, glassy overdecoration, and any room UI that implies a single broadcaster with a passive audience. Visual energy must clarify state: live streams, private admission, active host controls, reports, sanctions, and explicit watch/subscription choices.

**Key Characteristics:**

- Dense dark-mode product shell with a fixed narrow rail and compact panels.
- JetBrains Mono as the primary UI voice for labels, data, navigation, and room state.
- Violet is a signal color for primary actions, current navigation, and active affordances; coral is reserved for live/danger urgency.
- Tonal layering carries most depth; glows appear only for active/live/hover/focus states.
- Room semantics win over visual prototype nostalgia: Room Member Tiles, Stream Previews, Hosts, Past Streams, Reports, and Platform Admins must be labeled accurately.

## 2. Colors

The palette is a night-broadcast console: near-black navy surfaces, slate text ramps, violet signal accents, and coral live urgency.

### Primary

- **Stream Violet** (`oklch(0.68 0.19 265)`): primary actions, active rail state, selected controls, and explicit “this is current/ready” state. Keep it rare enough to remain meaningful.
- **Stream Violet Glow** (`oklch(0.68 0.19 265 / 0.55)`): active-state glow behind rail items, CTAs, and selected live controls. Use as state feedback, not ambient decoration.

### Secondary

- **Live Coral** (`oklch(0.72 0.22 25)`): live indicators, report/danger-adjacent emphasis, and urgent stream state. Do not use it for general brand warmth.
- **Host Green** (`oklch(0.78 0.18 150)`): success, allowed actions, online/healthy state, and admin-safe completion feedback.
- **Warning Amber** (`oklch(0.8 0.17 70)`): warnings, compatibility gates, and non-destructive risk states.

### Neutral

- **Void Deck** (`#080d18`): primary app background and full-screen canvas.
- **Rail Night** (`#0b1220`): fixed left rail and persistent chrome.
- **Panel Navy** (`#101725`): search fields, dark inputs, low-elevation panels.
- **Raised Panel** (`#151d2e`): popovers, profile menu, dialogs, and panels that need a step above the canvas.
- **Text Primary** (`#f8fafc`): body and critical labels on dark surfaces.
- **Text Secondary** (`#cbd5e1`): explanatory text that still needs body-level readability.
- **Text Muted** (`#94a3b8`): metadata and secondary labels; verify contrast before using below 12px.
- **Text Faint** (`#64748b`): counts, captions, and tertiary metadata only; never use for placeholders or paragraph text.
- **Line Soft** (`rgba(255, 255, 255, 0.10)`): default dividers and panel borders.
- **Line Strong** (`rgba(255, 255, 255, 0.20)`): selected boundaries, popovers, and interactive separation.

### Named Rules

**The Signal Rarity Rule.** Violet is for primary action, current selection, and state confirmation only; if more than 10% of a screen glows violet, the interface is shouting.

**The Coral Means Live Rule.** Coral belongs to live/danger urgency. Do not spend it on decorative gradients, avatars, or generic emphasis.

**The Contrast Before Mood Rule.** Body text and placeholders must meet WCAG AA against the exact panel color; never ship washed-out gray on navy just because it feels subtle.

## 3. Typography

**Display Font:** JetBrains Mono (with ui-monospace, Menlo, monospace fallback)  
**Body Font:** JetBrains Mono (with ui-monospace, Menlo, monospace fallback)  
**Label/Mono Font:** JetBrains Mono

**Character:** One mono family keeps room state, counts, timestamps, navigation, and moderation controls in the same operational voice. The type should feel compact and technical without becoming terminal cosplay.

### Hierarchy

- **Display** (900, `1.5rem`, `1.1`, `-0.025em`): route-level headings such as “Active Rooms.” Use sparingly; product UI does not use fluid display type.
- **Headline** (800, `1rem`, `1.25`, `-0.01em`): panel titles, room headers, and dashboard tab headings.
- **Title** (700, `0.875rem`, `1.25`): card titles, room names, popover headings, and section labels.
- **Body** (400, `13px`, `1.45`, `0.01em`): product copy, chat-adjacent prose, form help, and short explanations. Cap long prose at 65–75ch.
- **Label** (700, `0.68rem`, `1.2`, `0.04em`): buttons, chips, metadata, counts, and compact affordance text. Avoid all-caps as a universal section scaffold; use it only for state labels that benefit from scan speed.

### Named Rules

**The One Voice Rule.** Do not introduce display fonts into product controls, labels, data, or room panels. JetBrains Mono is the product voice.

**The Fixed Scale Rule.** Product surfaces use fixed sizes, not fluid clamp typography; responsive behavior is structural, not typographic theatrics.

## 4. Elevation

BhayanakCast uses tonal layers plus state glow. Panels sit on darker or lighter navy steps; borders define chrome; shadows and glows appear as active feedback for hover, current navigation, primary CTAs, live chips, and popovers. Depth should help users locate interaction state, not make every surface float.

### Shadow Vocabulary

- **Card Sheen** (`0 1px 0 var(--color-highlight) inset, 0 1px 2px var(--color-shade)`): low elevation for compact cards when the implementation uses tokenized prototype classes.
- **Popover Lift** (`0 1px 0 var(--color-highlight) inset, 0 6px 20px oklch(0 0 0 / 0.1)`): menus, dropdowns, and small overlays.
- **Deep Overlay** (`0 1px 0 var(--color-highlight) inset, 0 14px 40px oklch(0 0 0 / 0.14)`): dialogs or major transient panels.
- **Signal Glow** (`0 0 24px var(--color-primary-glow)`): active rail, current control, primary CTA, and live-selection affordances only.

### Named Rules

**The State Glow Rule.** Glow must communicate active, live, selected, or focused state. Decorative glow on inactive surfaces is prohibited.

**The No Ghost Card Rule.** Do not pair a decorative 1px border with a wide soft shadow on cards. Choose a tonal panel and border, or a purposeful state shadow, never both as garnish.

## 5. Components

### Buttons

- **Shape:** Compact rounded rectangle (`8px–10px`), full pill only for chips/badges.
- **Primary:** Stream Violet background, Text Primary foreground, `36px` default height, compact mono label, and a short color/shadow transition. Use for the single most important action in a local context.
- **Hover / Focus:** Hover may brighten or intensify the violet; focus must use a visible ring or border shift. Disabled must drop opacity and remove pointer affordance.
- **Secondary / Ghost / Tertiary:** Ghost buttons stay transparent until hover; secondary buttons use tonal navy or slate, not another saturated brand color.

### Chips

- **Style:** Pill shape (`999px`), `22px` height, small mono label, tonal background, and a small dot only when it encodes state.
- **State:** Live chips use Live Coral plus a subtle pulsing dot; selected/accent chips may use Stream Violet. Reduced motion must stop any pulse.

### Cards / Containers

- **Corner Style:** Panels and cards use disciplined radii (`12px–16px`). Do not exceed `16px` for cards or persistent panels.
- **Background:** Use Void Deck, Panel Navy, and Raised Panel steps instead of generic white/gray cards.
- **Shadow Strategy:** Tonal by default; state glow only when active/current/live.
- **Border:** Soft white alpha lines (`10%–20%`) define panels and chrome.
- **Internal Padding:** Dense panels use `12px–16px`; major page gutters use `20px`.

### Inputs / Fields

- **Style:** Search and text fields use Panel Navy, Text Primary, `12px` radius, a soft border, and left icon padding when an icon is present.
- **Focus:** Use a visible ring/border shift with violet or ring token. Focus cannot rely on glow alone.
- **Error / Disabled:** Error uses destructive/coral state plus text; disabled reduces opacity and cursor affordance without hiding labels.

### Navigation

- **Style:** The narrow rail is fixed, dark, icon-forward, and stateful. Active rail items use a tonal selected background, violet text/glow, and a clear marker. Tooltip labels provide discoverability.
- **Default / Hover / Active:** Default icons are muted slate; hover moves toward white with a subtle panel fill; active state must be unmistakable without depending on color alone.
- **Mobile Treatment:** Collapse or reposition structure intentionally; do not let fixed rail overlap content on narrow screens.

### Dialogs / Popovers

- **Style:** Raised Panel background, strong soft border, compact header, and owned shadcn/Radix primitives for accessibility.
- **Behavior:** Dialogs are for admission, settings, reporting, and moderation when inline treatment cannot preserve context. Modals are not the default answer for every interaction.

### Room Member Tiles / Stream Previews

- **Style:** Signature product components. They must distinguish subscribed stream media, unsubscribed blurred Stream Preview, non-streaming Room Member Tile, and My Stream Tile.
- **Behavior:** Watch/Stop Watching belongs on the tile. Host and streamer controls must be target-specific and keyboard reachable.

## 6. Do's and Don'ts

### Do:

- **Do** preserve the dense dark mono shell: Void Deck background, Rail Night chrome, Panel Navy inputs, and JetBrains Mono UI text.
- **Do** use Stream Violet for primary action, current navigation, selection, and focused affordances.
- **Do** reserve Live Coral for live/danger urgency and pair it with text or icon cues, never color alone.
- **Do** keep panels compact: `12px–16px` padding, `12px–16px` radius, soft borders, and tonal separation.
- **Do** label product states with BhayanakCast vocabulary: Room Member, Host, Stream, Stream Preview, Past Stream, Report, Platform Admin.
- **Do** include visible focus states, keyboard paths, and reduced-motion alternatives for dialogs, menus, tabs, tiles, and stream controls.

### Don't:

- **Don't** make BhayanakCast look like a generic SaaS dashboard, cream marketing page, or gradient-text hero site.
- **Don't** use glassmorphism as a default surface treatment or blur panels just to make them feel premium.
- **Don't** imply a single broadcast/audience model; rooms contain multiple member streams and explicit stream subscriptions.
- **Don't** hide private-room constraints, report targets, moderation actions, or admin controls behind hover-only affordances.
- **Don't** use Text Faint for placeholders, body copy, or required form help; it is tertiary metadata only.
- **Don't** use oversized card radii (`32px+`), side-stripe accent borders, repeating stripe backgrounds, decorative sketch SVGs, or wide soft shadows paired with decorative borders.
