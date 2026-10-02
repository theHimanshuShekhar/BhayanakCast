---
target: room screen
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/hshekhar/code/BhayanakCast/src/routes/room/$roomId.tsx"
target_fingerprint: "sha256:a83e0de52354de273983f5a7db8afd1583558ea5b7c2c70851633a63282c1153"
target_path: /home/hshekhar/code/BhayanakCast/src/routes/room/$roomId.tsx
timestamp: 2026-10-02T01-21-11Z
slug: src-routes-room-roomid-tsx
---
# Critique: Room (src/routes/room/$roomId.tsx) — run 1
Method: dual-agent (A design review, B detector), real browser in a held-live room; in-page detector both themes, desktop + phone.
Score 21/40 (Acceptable): 1:2 2:3 3:2 4:2 5:2 6:2 7:2 8:2 9:3 10:1
Specificity: generic video-call layout in house colours; voice and power-on authored; screens not dominant, reflow on share start, unequal/unstable share slots.
Detector: CLI clean (emoji size FP). Real: timestamps 2.44 dark/4.32 light; leave 3.05; LIVE chip 4.1; viewers toggle light 2.18; @mention light 2.71; phone targets 28-40px; phone panel not a dialog (no focus move, no Esc, focus escapes); no announcement for share start/stop; "55 online" double number; reduced motion honored.
## Priority issues
- [P1] Stage not screens-first: mosaic share zone, non-camera people as chips, stable slots, no reflow. layout
- [P1] Kick one-click permanent from hover-only menu (tile.tsx:298); people tab no actions. Confirm + people-row menu. harden
- [P1] Phone: tile controls unreachable (hover only), bottom nav in room, panel not a dialog. adapt
- [P2] Colour meaning: leave solid red 3.05 ($roomId.tsx:829), muted red, share slider red, own live share accent. colorize
- [P2] A11y: timestamps 2.44, mic ~21st tab stop, unnamed per-person buttons, no join/share announcements, accent-on-accent focus ring. audit/harden
## Minor
Feed same dot for all events; AUDIO ONLY on silent people; small phone breadcrumb targets; DESIGN.md screen-kind label/viewer count not rendered.
