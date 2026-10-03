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

## Addendum: refresh, freshness and ended rooms (#40)
- The route's ETag is the capture time, so a repeat request with a matching `If-None-Match` gets a 304 with no body. Answers stay `private`, because who may see a thumbnail depends on the caller.
- A room's last thumbnails are served after it ends, for the same 30 days as its recap (ADR 11), and only to whoever may see the room (ADR 16). Past cards and the recap show them desaturated, as "cached · X ago".
- Each upload tells the lobby (`lobby.changed`, change `thumbnail`) so live cards refetch without a reload; the page collapses these refetches to at most one per 5 seconds. Only public live rooms are announced: a private room's cards refresh on the next reload or list refetch.
- The 3-minute interval is a build-time setting (`VITE_THUMBNAIL_REFRESH_MS`, never below 5 s); the e2e server sets 8 s.

## Addendum: declared size is checked too (2026-10-02)
- The magic bytes aren't enough: a small file can declare a huge size, and every viewer of the room card would decode it. The upload route reads the size from the header itself (JPEG frame headers, WebP `VP8 `, `VP8L` and `VP8X`) and refuses anything declaring more than twice the capture size (960x540), a margin for a changed capture. A header that can't be read is refused too.

## Addendum: uploads time out and are retried (2026-10-02)
- An upload is no longer fire-and-forget: the send gives up after 15 s (`AbortSignal.timeout`), and a refusal (any non-2xx) counts as a failure like a network error. The capture and send together have 30 s, so a frame grab that never settles is a failure too and can't stall the share's uploads for good.
- If a share's first upload fails (or no frame could be captured), it is retried after 10 s, then 30 s, then 60 s, each wait counted from the failed attempt, so a room card isn't left on its placeholder for a whole 3 minutes. After the third retry it is left to the normal cadence; retries stop with the share. Later failures aren't retried early: the card keeps its last thumbnail and the next interval tries again.
