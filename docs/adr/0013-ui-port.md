# 13. Port the design as-is with Base UI primitives

Date: 2026-09-27 · Status: accepted

## Decision
- Port the claude.ai/design prototype (`BhayanakCast.html` + JSX) directly: Tailwind v4 via `@tailwindcss/vite`, the `@theme` oklch token set with its `.dark` overrides, JetBrains Mono, the hand-rolled stroke icon set, and the custom SVG line/bar charts.
- Use **Base UI** (unstyled) only for interactive primitives that need correct accessibility behaviour: Dialog (create room, settings), Menu (profile menu), Tabs (room sidebar), Switch, and Tooltip (rail labels).
- Prototype-only mechanisms are dropped: the CDN Tailwind, Babel-in-browser, `window` globals, the edit-mode `postMessage` bridge, and seed data. Components become ES modules, and data comes from server functions and the WebSocket.

## Consequences
- The visual result stays identical to the design.
- The design's "tweaks" (accent hue, radius, density, layout, chat panel, theme) become user settings (storage decided separately).

## Addendum: settings storage
Appearance settings are stored on the user's DB row, so they follow the user across devices, and cached in localStorage. Theme and accent are also mirrored into a cookie so SSR renders the right `dark` class and `--accent-h` without a flash.

## Addendum: profile URLs use the user id (2026-09-27)
Profiles live at `/profile/$userId`, not the Discord username. Discord usernames can be renamed and later reused by someone else, so an id-keyed URL never points to the wrong person. The page shows the current Discord username.

## Addendum: the room's "viewers" toggle hides everyone not sharing (2026-09-29)
In the design, the room header's "viewers" toggle hides only the collapsed viewer-only tiles (people without video). With real cameras (#35) it hides everyone who isn't sharing their screen, camera tiles included, and keeps the streamers (with their camera picture-in-picture). A camera that isn't on screen is paused towards that viewer (ADR 2 addendum), so hiding them saves the senders' upload. Its tooltip reads "Show people who aren't sharing". A later design port should keep this behaviour.

## Addendum: the home and room design pass (2026-09-30)
An Impeccable critique of home led to these deliberate deviations from the design. Later ports should keep them. DESIGN.md records the system, and PRODUCT.md records the product context behind it.
- **Contrast:** text on the accent (`--color-primary-ink`) is a dark ink, because near-white on the accent was 2.9:1. Dark theme's `--color-muted` is L 0.68, up from 0.62, so labels reach 4.5:1 on panels.
- **Home:** home gets a "start a room" button in its header, primary for signed-in users and secondary for visitors. For visitors, a sign-in intro sits above search at every width, replacing the sidebar's sign-in panel. The Right Now panel drops its "Live Rooms" tile, which repeated the Live Now count. The empty state loses its duplicate start button and glow tile. Cards show the room kind and a "full · wait for a spot" state, placeholder screens are tinted by room kind, and the phone bar has no accent swatch.
- **Motion:** a share starting switches its screen on like a monitor, and so does a room that goes live while home is open. New tiles and chat lines settle in, and dialogs scale in (they slide up on phones). Every animation has a reduced-motion path.

## Addendum: screens-first room stage (2026-10-02)
A first Impeccable critique of the room (21/40) led to these deliberate deviations from the design. DESIGN.md records the details.
- **Stage:** the room's 12-column tile grid becomes a screens-first stage. Every share goes in a screen zone using the room-card mosaic (one fills it, two split it, three are a hero plus a stack), cameras sit in a row below, and everyone without a share or camera is a compact chip, the signed-in user included. The layout setting (mosaic, grid, spotlight) now shapes the screen zone. Starting a share no longer reshuffles anyone else.
- **Controls:** "off" controls are neutral, so red means live only. The sharer's own share button turns live red and reads "live · stop", and leave uses the danger mix.
- **Moderation:** a kick asks for confirmation, naming the person and saying they can't rejoin (ADR 15). The people tab offers the same moderation menu as tiles.
- **Phones:** in a room, the app's bottom navigation is hidden, because the room's control bar takes the bottom.
- **Create dialog:** it no longer guesses a kind or a tag: a new room is "just chatting" with no tags until the host picks. Tags and the description sit behind a disclosure.
- **"viewers" toggle:** it keeps its earlier addendum's behaviour and now hides the camera row and the chips.

## Addendum: contrast and reduced motion (2026-10-03)
`src/styles/contrast.test.ts` computes WCAG contrast for every text and background pair the app uses, in both themes and at every accent hue, and fails under 4.5:1 (3:1 for the focus ring). It found the rest of what the design pass left.
- **Subtle text** is timestamps and metadata, so it reaches 4.5:1 on every panel: dark `--color-subtle` goes from L 0.45 (1.8:1 on Lifted Slate) to 0.68, light from 0.55 to 0.51. Dark `--color-muted` goes from 0.68 to 0.72 to stay a step above it.
- **Accent text** is `text-primary-strong` (links, the active rail item, stat numbers, the focus ring). The accent fill was 2.9:1 on light panels. Dark `--color-primary-strong` is L 0.74, up from 0.68, so it clears 4.5:1 on every panel at all six hues.
- **Placeholders** are `--color-muted` at full opacity: Tailwind's half-opacity placeholder was under 3:1.
- **Avatar initials** are dark ink: white was 1.6:1 on the amber gradient.
- **Motion:** the spatial parts of popup, toast, tooltip and toolbar transitions, and the accent swatch's hover scale, are `motion-safe:`. Opacity still fades.
