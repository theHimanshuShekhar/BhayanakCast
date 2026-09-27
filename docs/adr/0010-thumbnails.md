# 10. Streamer-captured room thumbnails stored in Postgres

Date: 2026-09-27 · Status: accepted

## Decision
- Each streamer's browser captures a frame of its own screen-share track every 3 minutes (and once when sharing starts), downscales it to about 480×270 WebP (~20–40 KB), and uploads it through an authenticated server function. The server accepts uploads only from a user who is currently streaming in that room.
- The latest thumbnail per stream is stored as `bytea` in Postgres and overwritten on each upload. When a room ends, the last thumbnails are kept as the room's cached mosaic.
- Thumbnails are served by the app with cache headers and deleted by the 30-day retention purge (ADR 11).

## Consequences
- No media ever reaches the server except these small stills.
- If the streamer's tab is backgrounded and throttled, the thumbnail goes stale. The card's "updated Xm ago" shows this honestly.
