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
