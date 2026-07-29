# ADR 0108: Count anonymous visitors in the Home presence number

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

Home's largest element is a live count of people, rendered by `PresenceCard` in the wide rail and `PresenceCounter` below it, both reading `ConnectedPresence`. It counted signed-in Accounts only, because `homePresence` keyed on `accountId` and the Socket.IO middleware rejected any handshake without a session with `Authentication required`.

Two things followed from that, and both worked against the number's only job. Anonymous visitors — the audience the clubhouse most wants to convert — were absent from a count that says "people in the clubhouse" while they are standing in it. And because they held no socket, `HomeRealtimeBridge` was mounted with `enabled={Boolean(session)}`, so an anonymous visitor saw the SSR value freeze on arrival and never move. A count under the words "Right now" that cannot change is worse than no count.

ADR `0011` already decided that discovery is public: rooms, previews, facets, Past Streams, profiles and presence are all served to anonymous visitors, and none of the Home server functions are session-gated. `0011` is silent on whether an anonymous visitor may hold a socket, because at the time nothing required one.

## Decision

The Home count is **one blended number**: distinct signed-in Accounts plus distinct anonymous visitors, presented without a split. `HomePresence.count()` sums both, and `peak()` follows automatically because `recordPeak` samples `count()` — today's peak is a peak of people, not of Accounts. The field names drop `Account`: `connectedCount` and `peakConnectedCount`.

Anonymous sockets are admitted. The middleware stops rejecting a sessionless handshake and tags it instead; the connection handler branches to `admitAnonymousVisitor` and returns before any account machinery — no `claimsByAccount` claim, no `ConnectionRegistry` entry, no `reclaimMembership`, no displacement, no `handleUnexpectedDisconnect`. Critically, **it registers no room listener at all**. A room command from an anonymous socket is not rejected; it is never heard. That is what keeps every room command account-only without a per-handler check, and it is the property to preserve when adding the next command.

An anonymous socket subscribes to the full `eventHub` stream. Every field in those events is already in the anonymous projection the same visitor can fetch over HTTP, so this is the realtime form of public data, not a new disclosure. Per-Account events (`HOME_ACCOUNT_REVOKED_EVENT`, `HOME_ACCOUNT_REPLACED_EVENT`) are emitted to specific sockets and never reach them.

**Dedupe** is by an opaque random id the client mints once and keeps in `localStorage`, sent in the handshake auth payload. This gives anonymous visitors the same "one person however many tabs" rule Accounts get; without it the same three tabs would count as 1 signed in and 3 signed out, inside a single number. It is client-supplied and therefore forgeable — but a forged id only ever splits or merges that client's own tabs, so it costs its owner an entry rather than earning them one. Where client storage is unavailable, the socket id stands in and a multi-tab visitor is overcounted rather than dropped.

**The ceiling** is 8 concurrent anonymous sockets per `hash(IP + User-Agent)`, claimed before the size check so racing handshakes cannot both take the last slot. Slots return on disconnect, so the cap throttles rather than locking a client out.

**The number is social proof, not a metric.** Anyone willing to open sockets can inflate it. That is accepted, not overlooked, and it is the reason the cap is 8 rather than something adaptive: the count is not load-bearing for billing, moderation, capacity, or any decision. A future caller that needs a trustworthy figure must derive it from Accounts and must not reach for `connectedCount`.

Browser fingerprinting was considered and rejected for both roles. Client-computed fingerprints (canvas/WebGL/font entropy) are sent by the client, so an inflater simply varies them — zero resistance to the only threat that would motivate them — while colliding across identical devices and shifting on browser or driver updates, which corrupts honest dedupe in both directions. Server-side passive fingerprinting is real, and is exactly what the `hash(IP + User-Agent)` cap already is. Stateless fingerprinting also carries a heavier consent burden under GDPR/ePrivacy than a first-party opaque token the visitor can inspect and clear, which is a poor trade to make on behalf of someone who has declined to sign in.

## Consequences

- `ConnectedPresence.connectedCount` and `HomeStatistics.peakConnectedCount` mean people, not Accounts. Neither is a trustworthy count of the community.
- Unauthenticated sockets are now a supported state. Any new `socket.on(...)` handler must assume an anonymous socket could exist; the early return in the connection handler is the guard, so new handlers belong **after** it and never before.
- `HomeRealtimeBridge` takes `anonymous` instead of `enabled` and always connects. Anonymous visitors get live room cards and a moving count for the first time.
- A signed-in visitor is never given a `localStorage` identifier — the id is minted only when anonymous.
- Socket connection volume rises roughly with anonymous traffic rather than with sign-ins, which is the capacity figure to watch. `peakByDay` remains in-memory and still resets on restart, as it did before.
- ADR `0011`'s "browse without signing in" now includes holding a counted socket. Discovery reads stay public projections; nothing here admits an anonymous visitor to a room.
