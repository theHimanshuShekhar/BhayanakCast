# 20. Anonymous read-only socket for visitors, upgraded on sign-in

Date: 2026-09-27 · Status: accepted · Amends ADR 7

## Context
Visitors (signed out) can browse home, profiles and recaps (ADR 6 addendum). The side rail shows a live count of **online users**, and room lists update live. ADR 7 rejected every unauthenticated WebSocket upgrade.

## Decision
- Unauthenticated upgrades are accepted into a **read-only lobby channel**. It carries only public, list-level events: online-user count and public room list changes. It never carries room signalling, presence details, chat, or anything about private rooms.
- The server ignores any client message on an anonymous socket except heartbeat, and applies per-IP connection limits.
- After sign-in the client reconnects with the session cookie and becomes an authenticated socket. Only authenticated sockets can join rooms or count towards **online users**.

## Consequences
- Visitors see live counts without polling.
- The anonymous surface is small but public, so rate and connection limits and strict message validation are required.

## Addendum: visitors count towards online (2026-09-30)
The last Decision bullet is reversed in part: the side rail's count (and the home "Online" tile) is **one number, distinct signed-in users plus distinct visitors**. Only authenticated sockets can still join rooms.
- **Once per browser.** The client keeps a random `crypto.randomUUID()` in `localStorage` and sends it as the optional `visitorId` in `hello`, so several tabs are one visitor and another browser (or a private window) is another. If storage throws, the id lives in memory for the page. It is not a fingerprint.
- **Server.** The hub counts visitor sockets per id from `hello` until they close, in memory only: ids are never logged, persisted or sent to other clients, only the count goes out. An anonymous `hello` with no valid id counts as a visitor of its own (older clients, browsers without storage). A signed-in socket's `visitorId` is ignored. `lobby.changed` is sent only when the total changes. `PROTOCOL_VERSION` stays 1, as the field is optional.
- **Sign-in.** The anonymous socket closes as the authenticated one opens, so the server's count can dip by one while someone signs in or out and returns to the same total. The server sends the true count. The client debounces the count it displays from `lobby.changed` by 3 s (`ONLINE_SETTLE_MS`, TanStack Pacer; the e2e build sets it to 0 with `VITE_ONLINE_SETTLE_MS`, as other tests' sockets keep the count moving), so a dip that recovers within that never shows. A `lobby.snapshot` (the first paint, every reconnect) shows at once and drops any pending value. Discord sign-in is a full-page redirect, so a longer consent screen can still show the dip on other people's pages.
- **Abuse.** A client can invent ids to inflate the count, bounded by the existing per-IP cap on anonymous sockets. No new limit.

## Addendum: public reads are rate-limited per IP (2026-10-02)
Profile, user search and the home summary are open to visitors and each runs the live-stats queries, so each is limited **per client IP** (the one ADR 9 resolves, read from `cf-connecting-ip`), in memory, over a sliding minute, for visitors and signed-in users alike: **search 30**, **profile 60**, **home summary 120**, each counted apart (`PUBLIC_READ_LIMITS`, src/server/read-limit.ts). A page load is one profile or home read, and the pages refetch about once a minute. The home summary also refetches when a public room changes, which on a busy lobby is many times a minute, so the client **coalesces** that refetch: at once, then at most once per 5 s (`SUMMARY_REFETCH_MS`, as thumbnails do), so one tab uses at most about 13 home reads a minute and about nine tabs behind one IP fill the 120 budget. Search runs once typing pauses (200 ms) and gets the smallest budget.
- **Refusal.** The server function answers HTTP 429 with `Retry-After: 60`; the client throws `ReadRateLimitedError` ("Too many requests. Wait a moment and try again."). Home's user search shows "Too many searches. Try again in a minute." and stops retrying; the profile and home loaders show the router's default error page until route error UI exists (#77). Refused reads don't count against the window. Without the header (`pnpm dev`, which doesn't rewrite it) every request counts as one client.
- **Not limited.** The live and past room lists: they don't touch the stats queries and refetch on lobby changes (the live list coalesced, see the next addendum), so a budget would trip on a busy lobby.
- **Shared IPs.** Visitors behind one NAT share a budget; the limits leave room for that. Only e2e raises them (`PUBLIC_READ_LIMIT_SCALE`), as every test's browser connects from one IP.

## Addendum: the live room list refetches are coalesced (2026-10-03)
Every join, leave, rename, new stream and thumbnail in any public room used to refetch the live room list for every home viewer. The client now **coalesces** that refetch the way it does the summary's and, before this, the thumbnails': at once, then at most once per 5 s (`LIVE_LIST_REFETCH_MS`, `coalesce` in `lobby-live.ts`), so one tab does at most about 13 list reads a minute however busy the lobby is.
- **Ended rooms are not coalesced.** `ended` (and the first snapshot after a reconnect) invalidates every room read at once: the live list, the past lists, a room's detail and the home summary. A room that has ended must leave Live Now now, not when a window closes, or its Join button leads to "room not found". It fires once per room, so it can't burst. The summary read it triggers is outside the 5 s spacing above, so the "about 13 a minute" figure in the rate-limit addendum holds only while fewer than about that many rooms end a minute.
- **Where.** Joins, leaves, renames, streamers, host changes, new rooms and thumbnails ask for the live list's own query key, which `invalidateLobbyKeys` hands to the coalesced refetch; the broader `roomKeys.all` is invalidated directly.
