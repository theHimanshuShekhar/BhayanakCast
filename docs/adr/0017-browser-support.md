# 17. Browser and device support

Date: 2026-09-27 · Status: accepted

## Decision
- **Full support:** desktop Chrome, Edge and Firefox (current and previous major). Desktop Safari is best-effort.
- **Mobile:** watch, chat, mic and camera work; screen sharing is unavailable because mobile browsers lack `getDisplayMedia`, and the share control is hidden there. The design's responsive layouts (bottom nav, drawer sidebar) are kept.

## Consequences
- Codec negotiation (ADR 2) must cope with Firefox, which has no AV1/VP9 hardware encode in some setups, and fall back cleanly.
- A Firefox streamer sends H.264 (OpenH264), or VP8 where a pair has no H.264 on both sides, never AV1 or VP9: Firefox encodes those in software only and reports no CPU limit. Detected by user agent. What a Firefox viewer receives is unchanged (ADR 2, codecs addendum).
- E2E tests run on Chromium and Firefox.
