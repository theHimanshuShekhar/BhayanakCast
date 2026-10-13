# 3. NAT traversal: STUN plus pluggable TURN, Cloudflare free tier from day one

Date: 2026-09-27 · Status: accepted

## Context
Some peer pairs behind CGNAT or strict/mobile NATs cannot connect directly (ADR 1). TURN fixes this by relaying their media, which costs relay bandwidth.

## Decision
- ICE servers are configuration, not code: a server function returns the ICE server list (STUN plus zero or more TURN providers) with short-lived credentials. Adding self-hosted coturn or another hosted TURN later means changing config only.
- STUN is always on.
- **Cloudflare Realtime TURN** is enabled from the start. Its free tier is 1,000 GB/month of egress, then $0.05/GB. Credentials are minted per session by a server function using the Cloudflare TURN key, so the key never reaches clients.
- Metered Open Relay (20 GB/month free) is a possible secondary provider. It is not enabled by default.

## Consequences
- Relayed pairs send their media through Cloudflare; this is the only case where media leaves peer-to-peer.
- Relayed bandwidth needs monitoring against the 1 TB/month free tier (admin dashboard candidate).
- A pair that fails even with TURN shows a per-peer "can't connect" state instead of silently missing tiles.

## Addendum: double NAT / CGNAT is best-effort for now
- Some users are expected to be behind double NAT or CGNAT. For now traversal is **best-effort**: gather all ICE candidates (host, server-reflexive via STUN, and relay via Cloudflare TURN), use ICE restart on connection failure, and try TURN over UDP, TCP and TLS on port 443 before giving up.
- A pair that still fails shows the per-peer "can't connect" state, and its ICE failure details are logged so we can see how often it happens.
- Dedicated handling (self-hosted coturn, IPv6-first candidates, relaying through a well-connected peer) is deferred until the logs show it is needed.

## Addendum: credentials per user, one provider (2026-09-29)
- TURN credentials are minted **per user**, not per session. They last 4 hours, and the server caches them per user and mints new ones 30 minutes before they expire. Reloads, rejoins and a second tab reuse the cached credentials instead of calling Cloudflare each time. Only that same signed-in user ever receives them, and they expire soon enough that per-session minting would add Cloudflare calls without meaningfully limiting exposure.
- The server returns a single TURN provider (Cloudflare) rather than the "zero or more" this ADR allows for. The ICE-server list is still built only on the server, so adding a second provider (Metered, or self-hosted coturn) means changing that server code and its config, not the client.
- Pages report only pairs that got as far as ICE, whether they relayed or failed after an ICE restart. A pair whose offer or answer never arrived gets one automatic start-over. If that also stalls, it shows "can't connect" but is not logged as an ICE failure, so signalling problems don't inflate the double-NAT numbers.

## Addendum: TURN usage panel on the admin dashboard (2026-09-29)
- The panel shows **account-wide** TURN egress, not one TURN key's: Cloudflare's 1,000 GB free tier is per account (TURN and SFU are billed together), so a per-key figure could look safe while the account is not. Rows from every key are summed.
- It reads Cloudflare's GraphQL Analytics API (`callsTurnUsageAdaptiveGroups`, egress bytes by hour, summed into UTC days for the current month) with a **separate read-only analytics token** (Account Analytics: Read) and the account id, `CLOUDFLARE_ANALYTICS_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The TURN API token can mint credentials, so it isn't reused. Both are optional: without them the panel says "not configured".
- The answer is cached in memory for 15 minutes, keyed by month so the 1st never shows last month's total. A failed call isn't cached; the panel says "usage unavailable" and the rest of the dashboard is unaffected.
- The panel warns at 80% of the free tier (800 GB).
- 1 GB is taken as 10^9 bytes. Cloudflare doesn't say whether it means GB or GiB; decimal shows a slightly higher percentage, so it errs on the side of warning early.

## Addendum: TURN arriving late restarts failed pairs (2026-10-02)
A page whose ICE-server fetch failed starts on STUN alone (and asks again every minute). Pairs that failed in that time stayed `failed` even after TURN credentials arrived. When TURN servers appear where there were none, the Mesh now gives every `failed` pair that had negotiated one more ICE restart with the new servers. Credential refreshes after that restart nothing, and a pair that never negotiated is still a signalling stall, not an ICE failure.

## Addendum: TURN only for people in a room they may enter (2026-10-02)
- TURN relays traffic for whoever holds credentials, so the server hands them out only to a signed-in user asking for a **live room they may enter**: it is live, visible to them (ADR 16) and they weren't kicked from it (ADR 15). That is the rule the realtime server applies on a join, so it also covers the page's first fetch right after the lobby. Anyone else gets STUN only (and asks again after a minute, in case the room has opened up to them).
- `getIceServersFn` therefore takes the room id. Credentials stay cached **per user**, not per room: switching rooms reuses a valid cached credential, and the room only decides whether it is handed out.
- Credentials already minted stay valid until they expire (at most 4 hours), even if the user is then kicked; the check keeps new ones, and the cached ones, from being handed out again.
- TURN goes to anyone who may enter the room. For a public live room that means any signed-in account can get credentials by naming its id, without joining. That is accepted: the room must be live and visible to them, which is much narrower than any signed-in user at any time.

## Addendum: connection events replace the ICE reports (2026-10-14)
This **supersedes** the ICE-report parts of the addenda "double NAT / CGNAT is best-effort for now" ("its ICE failure details are logged") and "credentials per user, one provider" ("Pages report only pairs that got as far as ICE..."). The anonymised reports of relayed or failed pairs (`reportIceFn`, its rate limit, and the `ice.report` server log event, once the `[ice] {…}` line) are **removed**. Each browser now reports its own connections to the **room timeline** (CONTEXT.md; ADR 11 addendum), with real user ids, admin-only, 90 days. That is one source of truth for how often double NAT bites and why a pair failed, and it names the people and the room. The decision is in issue #110, the build in #116. The server log's `ice.mint_failed` event, for failing to mint TURN credentials, stays; it is about the server, not a page.
- **Per pair** (this browser as actor, the peer as target): every connection state (`pair_state`: connecting, connected, disconnected, failed); each ICE restart or automatic or manual start-over, and why (`pair_restart`: failed, timeout, TURN arrived, retry, the peer started over), and whether it recovered, and how long it took (`pair_recovery`); the path when the pair connects and whenever it changes (`pair_path`: direct or relay, candidate types, and UDP/TCP/TLS for a relay; checked on each quality pass); and negotiation errors (`negotiation_error`: a failed offer or answer, a description or candidate the browser refused, or a pair that never negotiated), with the error's name and message.
- **Per browser:** a refused or failed mic, camera or screen picker (`device_error`), and audio the browser would not autoplay (`audio_blocked`, once per track). A device error in the pre-join lobby is recorded against the room being joined.
- **No addresses, device labels or ids.** The path keeps candidate types and transports only. An error keeps its name, its message cut to 200 characters on one line, and the kind of device. The page replaces the labels and ids of the devices it has listed in the message, and the page and the server both replace anything shaped like a device id or an IP address. A label the page has never seen (the browser lists none before permission) cannot be replaced; none of the browsers' own messages is known to carry one.
- **Transport.** A batched server function, `reportConnectionFn`, like quality samples (ADR 2 addendum) and for the same reason: it keeps the hub's serial queue free and works while the socket reconnects. A report holds at most 50 events and is checked again on the server. The caller must be signed in. Pair events need the caller in the live room and the peer in it too; a device error needs the caller in the room, or, for the lobby, allowed to enter it (the rule of the TURN addendum above). Reports are rate-limited to 100 per person per 10 minutes. The server dates each event by its own clock from the age the page gives (clamped to 30 minutes).
- **Delivery.** Events wait about 3 s for company. A queue of the newest 200 holds what fails to send and retries with the next batch (or after 30 s). When the page is hidden or closed, the queue is handed to `navigator.sendBeacon`. A server function cannot be called by a beacon (its URL and body belong to the framework), so the beacon posts the same report to a route of its own, `/api/connection-events`. **A beacon is a same-origin POST, so the browser sends the session cookie with it** (SameSite does not stop that), and the route reads the session from it exactly as a server function does, refuses another origin, and checks the same rules. The body is a JSON `Blob`, 64 KiB at most.
- **Cap.** Flapping is the diagnosis, so every transition is recorded, up to about **120 events per person per 10 minutes** across rooms. Past that, events are dropped and one `events_dropped` row (`details.count`) records how many. It is written once no drop has come for a minute, dated at the first drop; a marker waiting when the server stops is lost.
