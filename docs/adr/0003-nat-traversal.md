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
