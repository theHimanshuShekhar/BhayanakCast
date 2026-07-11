# ADR 0096: Use a porcelain-and-midnight clubhouse visual system

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

The Home structure is defined, but implementation needs an exact visual baseline rather than generic “friendly” styling. It must distinguish product identity from live, privacy, host, warning, and destructive state while working equally in light and dark themes.

## Decision

### Typography

Self-host Source Sans 3 variable WOFF2 assets; do not depend on a third-party font request. Use Source Sans 3 for display, UI, statistics, and body copy, with a system sans fallback. Use a fixed comfortable scale: 13px minimum labels, 14px metadata, 16px body/control text, 18px normal card titles, 24px section titles, 30px featured-room title, and 36px only for rare page headings. Use tabular numerals for changing counts and metrics.

### Theme tokens

Light theme:

| Role | Value |
| --- | --- |
| Canvas | `#F6F8FC` |
| Surface | `#FFFFFF` |
| Subtle surface | `#EDF1F7` |
| Primary text | `#172033` |
| Secondary text | `#536078` |
| Muted text | `#6B778D` |
| Border | `#D7DEE9` |
| Strong border | `#AAB5C5` |
| Cobalt action | `#2457D6` |
| Cobalt hover | `#1946B8` |
| Cobalt soft | `#E6EDFF` |
| Live | `#C52B69` |
| Host/success | `#147A5A` |
| Warning | `#946000` |
| Danger | `#B83232` |
| Private | `#6842B8` |

Dark theme:

| Role | Value |
| --- | --- |
| Canvas | `#0D1422` |
| Surface | `#141D2D` |
| Subtle surface | `#1B2639` |
| Raised surface | `#202D43` |
| Primary text | `#F4F7FC` |
| Secondary text | `#BBC5D5` |
| Muted text | `#94A0B3` |
| Border | `#2B3950` |
| Strong border | `#43536D` |
| Cobalt action | `#82A5FF` |
| Cobalt hover | `#A1BAFF` |
| Cobalt soft | `#1B3264` |
| Live | `#FF72A5` |
| Host/success | `#55D5A9` |
| Warning | `#F2B84B` |
| Danger | `#FF7B72` |
| Private | `#B99AFF` |

White text is used on the light cobalt action; dark ink `#0B1630` is used on the dark cobalt action. The selected text/background pairs meet at least WCAG AA in the checked palette; implementations must still test actual component combinations and non-text contrast. Semantic hues never substitute for labels/icons.

### Geometry, spacing, and elevation

Use a 4px spacing base with primary steps 8, 12, 16, 24, 32, and 48px. Room cards and substantial panels use 12px radii; inputs, buttons, menus, and compact surfaces use 8px; only avatars and status/tag chips use full pills. Prefer thin borders and surface contrast. Light raised surfaces may use `0 8px 24px rgb(23 32 51 / 0.08)`; dark surfaces rely primarily on borders and lightness rather than broad shadows.

### Home frame and navigation

At 1280px and above, center a frame capped at 1600px with a 216px left rail, a fluid center constrained to 640–1040px, a 280px right rail, and 24px gaps/padding. The 768–1279px stage uses a 72px icon-only left rail and at least 16px center gutters. Small layouts use 16px gutters, a 56px top brand bar, and a 64px bottom navigation plus safe-area inset.

The wide rail uses icons with labels and a cobalt inset active marker. The medium icon rail provides accessible names and hover/focus tooltips. Small bottom navigation always shows icon and label for Home, Create, and Profile/Log in; Create is the primary cobalt action, while active destination state remains distinct from destructive/live semantics.

### Motion

Use one ease-out curve, `cubic-bezier(0.2, 0.8, 0.2, 1)`: 120ms for control/color feedback, 180ms for menus/popovers/sheets, and 240ms for layout/state transitions. Do not bounce. A live indicator may use a subtle opacity pulse only. Reduced-motion mode removes transforms and pulses and applies state changes immediately while preserving visible confirmation.

## Consequences

- Home can be implemented and visually tested from stable tokens instead of page-local guesses.
- Light/dark themes share hierarchy but use intentionally different action foregrounds and elevation treatment.
- Source Sans 3 adds self-hosted font assets; subset only if the English-only glyph coverage and licensing metadata remain correct.
- Desktop editorial media stays substantial while rails remain close enough for scanning.
