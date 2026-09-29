# 10. Streamer-captured room thumbnails stored in Postgres

Date: 2026-09-27 · Status: accepted

## Decision
- Each streamer's browser captures a frame of its own screen-share track every 3 minutes (and once when sharing starts), downscales it to about 480×270 WebP (~20–40 KB), and uploads it through an authenticated server function. The server accepts uploads only from a user who is currently streaming in that room.
- The latest thumbnail per stream is stored as `bytea` in Postgres and overwritten on each upload. When a room ends, the last thumbnails are kept as the room's cached mosaic.
- Thumbnails are served by the app with cache headers and deleted by the 30-day retention purge (ADR 11).

## Consequences
- No media ever reaches the server except these small stills.
- If the streamer's tab is backgrounded and throttled, the thumbnail goes stale. The card's "updated Xm ago" shows this honestly.

## Addendum: upload route and visibility (#39)
- Uploads go through an API route (`POST /api/thumbnails/:roomId`, raw image body) rather than a server function, because the body is binary. The route checks the request's origin, requires sign-in, rate-limits per user, and caps the body at 100 KB (WebP or JPEG, checked against the file's own header).
- `GET /api/thumbnails/:roomId/:userId` applies the room-visibility rule (ADR 16): a private room's thumbnails answer 404 to anyone not allowed in.
