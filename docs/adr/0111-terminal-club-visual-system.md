# ADR 0111: Adopt the terminal-club visual system

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

ADR `0096` established the Home composition, density, type scale, geometry, responsive stages, motion, and first intentional light/dark palette. Its porcelain-and-cobalt surface treatment and Source Sans 3 typography no longer describe the product that Home and Room share. The implementation needs one exact visual world across discovery, room media, companions, chat, controls, and statistics without reopening the structural decisions that already make those surfaces work.

A monospace face also removes the width contrast on which the earlier typographic hierarchy depended. Identity, navigation, selection, action, Live, Host, warning, danger, and private state must remain distinguishable without assigning one hue two meanings, and component boundaries must remain visible at the WCAG 2.2 non-text contrast floor in both themes.

## Decision

ADR `0111` supersedes ADR `0096`'s typography and theme-token decisions. Everything else decided by `0096` remains in force: the Home composition and responsive stages, adaptive density, fixed 13/14/16/18/24/30/36px scale, 4px spacing base, radius roles, breakpoints, z-layers, motion curve and 120/180/240ms durations, reduced-motion behaviour, and tabular numerals for changing counts and metrics.

### Typography

Self-host the latin-subset JetBrains Mono variable WOFF2 vendored at `public/fonts/jetbrains-mono-latin.woff2`, with a 100–800 weight axis and `font-display: swap`; do not depend on a third-party font request. JetBrains Mono is the single family across display, UI, chat, statistics, and body copy, with a monospace system fallback.

Use weight rather than width for hierarchy: 700 for titles, headings, status words, and eyebrows; 600 for buttons and interactive labels; 450 for body and chat; and 400 for muted metadata. No weight falls below 400 or exceeds the asset's 800 ceiling. This replaces the old width-based inversion because a monospace face cannot vary glyph width, leaving weight as the typographic lever.

Tracking has five steps: -0.03em at 36px and 30px, -0.02em at 24px, -0.01em at 18px, 0 at 16px and 14px and for ordinary 13px labels, and +0.08em only for uppercase 13px eyebrows.

### Theme tokens

Dark is the canonical terminal-club world and light is its daylight counterpart. `:root` carries the dark values; `[data-theme="light"]` overrides them. The bootstrap script still resolves the device preference and any persisted user override before paint. Without JavaScript, the `:root` default is therefore dark. Both themes remain intentional product surfaces rather than one being a generated inversion of the other.

Dark theme:

| Role | Value |
| --- | --- |
| Canvas | `#0b0e14` |
| Surface | `#141924` |
| Subtle surface | `#0f141d` |
| Raised surface | `#1b2130` |
| Rail | `#0f141d` |
| Primary ink | `#e6eaf3` |
| Secondary ink | `#a5b0c4` |
| Muted ink | `#8b96ab` |
| Faint ink | `#7e899b` |
| Border | `#232b3a` |
| Strong border | `#5c6b8b` |
| Violet action | `#c084fc` |
| Violet hover | `#d9b3ff` |
| Violet soft | `#2a1f47` |
| Action ink | `#150b26` |
| Live | `#ff5f8f` |
| Host/success | `#4ade80` |
| Warning | `#fbbf24` |
| Danger | `#ff7a63` |
| Private | `#22d3ee` |

Light theme:

| Role | Value |
| --- | --- |
| Canvas | `#f2f4f8` |
| Surface | `#ffffff` |
| Subtle surface | `#e9edf4` |
| Raised surface | `#ffffff` |
| Rail | `#e9edf4` |
| Primary ink | `#131722` |
| Secondary ink | `#4c586e` |
| Muted ink | `#59657c` |
| Faint ink | `#59657c` |
| Border | `#dbe1ec` |
| Strong border | `#7b889f` |
| Violet action | `#7326d9` |
| Violet hover | `#5c17b8` |
| Violet soft | `#eee6ff` |
| Action ink | `#ffffff` |
| Live | `#c62a5e` |
| Host/success | `#0d7a4f` |
| Warning | `#8a5a00` |
| Danger | `#bc422a` |
| Private | `#0e7490` |

Media tokens are theme-invariant: the media canvas is `#05070b`, its violet edge is `#2a1f47`, and the existing `--on-media-*` names retain their dark terminal values so status remains legible over captured frames.

Violet carries identity, navigation, selection, and action. Rose-red means Live, green means Host and success, amber means warning, coral-red means danger, and cyan means private. Private moves off violet because violet is now the identity glaze. These six hues are spaced across the hue circle so no hue means two things; the word or icon still accompanies semantic colour.

`--border-strong` clears the WCAG 2.2 3:1 non-text contrast floor in both themes wherever a UI boundary is required. The previous strong-border tokens measured only 1.78:1 in dark and 2.95:1 in light.

### Chrome, geometry, and motion

The terminal-club chrome uses near-black slate grounds, a violet identity glaze, pill silhouettes, and hairline boundaries. Status pills pair their semantic word with its hue and, for Live or broadcasting state, a leading same-family dot. Descriptive tags and categories use neutral outlined pills and are not interactive. Card and row internals divide with dotted hairlines rather than solid rules or shadows.

The existing radius roles remain: 12px for cards and substantial panels, 8px for controls, 5px for compact chips, and full pills for avatars and status/tag chrome. Existing Home and Room layouts, density, breakpoints, z-layers, the `cubic-bezier(0.2, 0.8, 0.2, 1)` curve, 120/180/240ms durations, Live-only pulse, and reduced-motion behaviour do not change.

## Consequences

- Home and Room share one terminal-club vocabulary without changing composition, copy, behaviour, semantics, accessibility, or responsive structure.
- The single monospace family makes weight and the fixed tracking ladder load-bearing; introducing a second family or a width-based display treatment would undo the hierarchy.
- Dark is the no-JavaScript default. Device preference and the persisted override still select either intentional theme before paint when the bootstrap script runs.
- `meta[name="theme-color"]` uses `#0B0E14` for dark and `#F2F4F8` for light.
- Pill-and-hairline chrome increases semantic repetition deliberately: status words remain present, dotted divides remain structural, and colour never carries state alone.
- The vendored latin subset excludes U+2192, so UI arrow cues use `->` rather than a fallback glyph. User-provided Unicode content is unchanged.
