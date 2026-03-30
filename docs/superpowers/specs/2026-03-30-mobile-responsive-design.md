# Mobile Responsive Design

**Date:** 2026-03-30
**Status:** Approved

## Problem

BhayanakCast is desktop-first. On mobile the layout breaks in three critical ways:
1. The left sidebar (w-16/w-60) eats horizontal space with no mobile alternative
2. The room page 2-column layout (flex row with w-80 chat sidebar) forces horizontal scrolling or collapses to unreadable
3. The home page stats panel is `hidden xl:block` — it disappears entirely on mobile

Desktop remains the primary platform. Mobile should be fully usable.

## Decisions Made

- **Navigation:** Sidebar becomes a compact top bar on mobile (brand left, theme + user right). Desktop sidebar unchanged.
- **Room page:** 2-column stacks vertically on mobile — video on top, action buttons + viewers strip below, chat fills remaining height, input pinned to bottom.
- **Home stats panel:** Moves below the room list on mobile instead of being hidden.
- **Implementation strategy:** Targeted Tailwind responsive prefixes (`sm:`, `md:`) following the existing pattern in `RoomList.tsx`. Complex layout changes (room page) use a small CSS helper class.

## Scope

Mobile breakpoint: `md` (768px). Everything below `md` gets the mobile layout.

### Files to Change

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Add `hidden md:flex` to existing sidebar; add a new `<TopBar>` sub-component rendered only on mobile (`flex md:hidden`) |
| `src/routes/__root.tsx` | Remove `overflow-hidden` from `<body>` on mobile so page can scroll naturally; adjust flex layout to account for top bar instead of sidebar |
| `src/routes/index.tsx` | Stats column: change `hidden xl:block` → `block xl:block` (show below list on mobile) |
| `src/routes/room.$roomId.tsx` | Room layout: `flex` → `flex-col md:flex-row`; chat sidebar: `w-80 min-w-80` → `w-full md:w-80 md:min-w-80`; back-bar height: adjust for mobile top bar |
| `src/components/Chat.tsx` | Remove hardcoded `w-80 min-w-80`; let parent control width |
| `src/styles.css` | Add `env(safe-area-inset-*)` padding for notched phones |

### What Does NOT Change

- Desktop layout — zero regressions
- Streaming controls (CLAUDE.md: mobile users cannot be streamers — no streamer UI needed on mobile)
- Room cards grid (already responsive: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)
- Theme system, colors, fonts
- Chat bubble styling
- Any backend / WebSocket logic

## Design Details

### 1. Mobile Top Bar (`Header.tsx`)

The existing sidebar renders with `hidden md:flex`. A new `TopBar` component renders with `flex md:hidden`:

```
[ BhayanakCast ]  ............  [ ◑ theme ]  [ 👤 user ]
```

- Full width, fixed height (`h-12`)
- Left: brand name (same accent color as sidebar logo)
- Right: ThemeSwitcher + UserButton (same components, just horizontal)
- `border-b border-border-subtle` separator

### 2. Root Layout (`__root.tsx`)

Current body: `flex h-screen w-screen overflow-hidden`

Mobile changes:
- Body becomes `flex flex-col md:flex-row` (top bar above content on mobile, sidebar left on desktop)
- Content area loses `overflow-hidden` on mobile so it can scroll naturally
- `h-screen` retained on desktop; on mobile height is natural

### 3. Home Page (`index.tsx`)

Current two-column container: `flex gap-8` with right stats column `hidden xl:block w-72 shrink-0`.

Mobile change:
- Container: `flex gap-8` → `flex flex-col xl:flex-row gap-8` (stack vertically on mobile, side-by-side at xl+)
- Stats column: `hidden xl:block w-72 shrink-0` → `w-full xl:w-72 xl:shrink-0` (full width below list on mobile, fixed 288px sidebar at xl+)

### 4. Room Page (`room.$roomId.tsx`)

Current: `flex h-[calc(100%-53px)]` with fixed 320px chat column.

Mobile layout (stacked):
```
┌──────────────────────┐
│  ← Back   Room Name  │  (back bar)
├──────────────────────┤
│                      │
│    Video (16:9)      │
│                      │
├──────────────────────┤
│  [Join] [Leave]  👥  │  (actions + viewers strip)
├──────────────────────┤
│  Chat messages       │
│  (flex-1, scrolls)   │
├──────────────────────┤
│  [Message input]  →  │  (pinned bottom)
└──────────────────────┘
```

Key class changes:
- Outer flex: `flex flex-col md:flex-row`
- Chat sidebar: `w-full md:w-80 md:min-w-80 border-t md:border-t-0 md:border-l`
- Height: `h-[calc(100vh-48px)] md:h-[calc(100%-53px)]` (accounting for top bar on mobile)

### 5. Chat Component (`Chat.tsx`)

Remove `w-80 min-w-80` from the root `<div>` — width is now controlled entirely by the parent in `room.$roomId.tsx`. Internal layout (`flex flex-col h-full`) unchanged.

### 6. Safe Area Insets (`styles.css`)

```css
@supports (padding: env(safe-area-inset-bottom)) {
  .safe-bottom {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
```

Apply `safe-bottom` to the chat input bar and mobile top bar so content isn't hidden by iPhone notches/home indicators.

## Verification

1. **Mobile Chrome DevTools** — test at 390×844 (iPhone 14) and 360×800 (Android)
2. **Home page:** Room list fills full width; stats card appears below list
3. **Room page:** Video stretches full width; chat scrolls below; chat input stays visible when keyboard opens
4. **Navigation:** Top bar visible; sidebar hidden; theme switcher and user menu work
5. **Desktop regression check:** At 1280px+ everything looks identical to before
6. **`pnpm check`** — Biome lint passes
7. **`pnpm test:unit`** — no unit test regressions
