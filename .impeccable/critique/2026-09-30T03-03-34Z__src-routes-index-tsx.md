---
target: home page
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/hshekhar/code/BhayanakCast/src/routes/index.tsx"
target_fingerprint: "sha256:fedc64fff352048af36dff57495d8aeb2e9d5741e7a4f7977c18031965b715d0"
target_path: /home/hshekhar/code/BhayanakCast/src/routes/index.tsx
timestamp: 2026-09-30T03-03-34Z
slug: src-routes-index-tsx
closed: true
---
# Critique: Home (src/routes/index.tsx)
Method: dual-agent (A: design review · B: detector). No browser automation host; no overlay. B scanned source + https://cast.bhayanak.net headless (1280x800, 390x844).

## Design Health Score: 22/40 (Acceptable)
1 Status 3 · 2 Real world 2 · 3 Control 3 · 4 Consistency 2 · 5 Error prevention 2 · 6 Recognition 2 · 7 Flexibility 2 · 8 Minimalist 3 · 9 Error recovery 2 · 10 Help 1

## Design Specificity
Mosaic cards are product-specific; surrounding chrome (Active Rooms, stats sidebar, broadcaster copy) is generic streaming directory. PRODUCT.md voice absent; "3 screens at once" never stated.
Detector: source 6 findings (1 FP test regex; 6px initials room-cards.tsx:71 real). Live 38/36: white on accent #5d90ff 2.9:1 (primary buttons), stat labels 4.3:1, #51555c 2.6:1; 11 sub-11px texts (9.5px off-ramp); glow/clipping mostly intentional FPs; empty-state glowing icon tile real; 2 nested cards. No prefers-reduced-motion anywhere.

## Priority Issues
- [P1] Start a room nearly invisible when rooms exist (sidenav.tsx:137, index.tsx:200). Fix: persistent primary button by heading + labeled mobile item. /impeccable layout
- [P1] Ink-on-accent contrast 2.9:1 on all primary buttons; worse on light hues. Fix: dark ink or darker fill (primary-strong); verify 6 presets; update DESIGN.md. /impeccable harden
- [P1] Visitors get no explanation; sign-in panel last below lg (index.tsx:405). Fix: visitor strip with tagline, 3-screens promise, sign-in, mic/cam-off reassurance. /impeccable onboard
- [P2] No reduced motion; text-subtle ~2.6:1 at 11px; 9.5px/6px text; card aria-label hides occupancy/private (room-cards.tsx:157). /impeccable harden, typeset
- [P2] Cards hide join-deciding states: private/full look open; kind/tags not shown; placeholder hue hard-coded (room-cards.tsx:137). /impeccable clarify

## Persona Red Flags
Jordan: link bounces to home + sheet, no explanation, no Discord-scope note. Casey: unlabeled sign-in glyph, accent swatch next to nav, 40px targets, panels buried, no desktop-only share note. Sam: cards announce only "Join X", no skip link, no live region, no motion opt-out, 2.9:1 buttons. Crew host: bare "+", private rooms undiscoverable, no crew-live strip.

## Minor
SectionBar duplicates SectionHead (8px dot); glowing empty-state tile; empty Filling Up header + literal "no host" (index.tsx:430); truncated names lack title; stale screenshots; generic <title>.

## Questions
Lead with biggest-screens room instead of search + stats? Twitch directory vs friend's basement? Home designed for the host?
