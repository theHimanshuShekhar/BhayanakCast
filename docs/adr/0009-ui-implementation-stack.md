# UI implementation stack

BhayanakCast's final implementation should stay visually as close to the extracted design prototype as practical while using Tailwind CSS v4 and shadcn/ui as the implementation stack. Tailwind v4 provides CSS-first configuration with `@import "tailwindcss"` and `@theme` design tokens; shadcn/ui provides copied, owned React components configured for Tailwind v4 with CSS variables and no Tailwind config file.

## Consequences

- The prototype in `docs/design/prototype/` is the visual reference for layout, density, color mood, typography, mosaic behavior, side rail, room panels, profile, and admin surfaces.
- `CONTEXT.md` and ADRs still override prototype semantics when labels or behavior conflict with product decisions.
- Tailwind v4 theme tokens should encode the prototype's colors, typography, shadows, radii, and motion rather than scattering one-off values through components.
- shadcn/ui components should be treated as owned source code and restyled to match the prototype; default shadcn visuals are a starting point, not the target aesthetic.
- Prefer shadcn/Radix primitives for dialogs, menus, tabs, tooltips, forms, scroll areas, and accessible controls; custom components remain appropriate for the room mosaic, stream tiles, avatars, status chips, and media controls.
- The shadcn configuration should use CSS variables, the `new-york` style unless a stronger local reason emerges, Tailwind config path empty for v4, and the Lucide icon library.
- Motion is part of the visual system. Use subtle Tailwind/CSS transitions and keyframes for state changes that need orientation or polish: room-card hover, rail active markers, dialogs, menus, tabs, stream tile subscribe/unsubscribe, thumbnail loading, host-control affordances, chat insertion, report/sanction feedback, and live/presence indicators.
- Motion must be restrained: short durations, low travel distance, opacity/transform/color/shadow changes first, no gratuitous page choreography, and respect `prefers-reduced-motion`.
- V1 accessibility baseline: all dialogs, menus, tabs, forms, and stream controls must be keyboard operable with visible focus states and meaningful labels; reduced-motion preferences must disable non-essential motion.
- Do not add a dedicated animation library unless CSS/Tailwind cannot express a required interaction cleanly.
- TanStack Start remains the app framework. Use TanStack Router/Start route loaders and TanStack Query for server-state preloading, caching, invalidation, and reuse across route loaders/components when that state is not purely realtime Socket.IO state.
- TanStack Form may be used for complex validated forms when it reduces boilerplate around Zod schemas; simple forms can stay local with shadcn form primitives.
- TanStack Table may be used for admin/report/sanction tables if sorting, filtering, pagination, or column state become non-trivial; do not introduce it for static lists.
- Do not adopt a TanStack library only for branding consistency. Each TanStack dependency must replace real local complexity.
- TanStack Pacer is not a visual animation tool. It may be used for debounced discovery search, throttled resize/layout measurements, throttled thumbnail capture/upload triggers, or rate-limited client actions when it replaces hand-rolled timer code.
