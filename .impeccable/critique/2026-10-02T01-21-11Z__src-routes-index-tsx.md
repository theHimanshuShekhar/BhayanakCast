---
target: home page
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
target_identity: "file:/home/hshekhar/code/BhayanakCast/src/routes/index.tsx"
target_fingerprint: "sha256:614db78a21e3081eb415bb7a7d537b778a58bb4a3d92954b625192f840f3afa3"
target_path: /home/hshekhar/code/BhayanakCast/src/routes/index.tsx
timestamp: 2026-10-02T01-21-11Z
slug: src-routes-index-tsx
---
# Critique: Home (src/routes/index.tsx) — run 2
Method: dual-agent (A design review, B detector), real browser against seeded review server; in-page detector both themes.
Score 26/40 (Good): 1:3 2:3 3:3 4:2 5:3 6:3 7:2 8:2 9:3 10:2
Specificity: components authored (tally red, mosaic, full state, power-on); page skeleton generic directory.
Detector: CLI clean (4 avatar-initial advisories). Rendered 137/136, mostly DESIGN-sanctioned. Real: phone overflow; Streaming light 1.86:1; LIVE chip 4.1:1; BC logo 4.41/2.41; light placeholder 3.56:1; 34px buttons, 18px search input on phone.
## Priority issues
- [P0] Phone renders 739px wide: grid has no columns below lg (index.tsx:286), aside lacks min-w-0 (:425); long Filling Up name sets width. Fix minmax(0,1fr) + min-w-0 + e2e. adapt/harden
- [P1] Streaming text-success in light 1.86:1 (room-cards.tsx:233) -> success-ink; LIVE chip 4.1; logo. colorize/audit
- [P2] Visitors: four routes to one sign-in; reassurance missing from sign-in prompt. distill
- [P2] Create dialog: focus on Close, 15 pills, Gaming/#chill defaults, Enter doesn't submit, hang/room naming. clarify
- [P3] Sidebar duplicates/generic. layout/quieter
## Minor
Streaming stat icon speck; BC + Active Rooms duplicate links; Live Now count repeats status line; past-card footers wrap; +N overlaps avatar.
