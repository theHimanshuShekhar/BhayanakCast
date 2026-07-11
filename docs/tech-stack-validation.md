# BhayanakCast V1 technology-stack validation

**Research date:** 2026-07-11  
**Disposition:** **GO with corrections recorded in ADR 0104 and ADR 0105.** No additional framework, cache, queue, SFU, TURN service, ORM, authentication layer, or client state library is justified for the documented single-node/250-member V1.

## Executive assessment

The stack is internally compatible when treated as an exact reviewed baseline rather than a loose-latest dependency set. The most important correction is removal of PeerJS/PeerServer: stock PeerServer does not enforce BhayanakCast admission, so retaining it would add a second WebSocket route and custom peer-capability security. Browser-native `RTCPeerConnection` plus the already authenticated Socket.IO channel is the smaller and safer boundary. Media remains direct P2P.

TanStack Start remains officially Release Candidate and TanStack Pacer remains beta. Both are usable for V1 with exact pins, narrow APIs, a committed lockfile, and focused behavior checks before upgrades. TanStack Query, Socket.IO, PostgreSQL, Drizzle, Better Auth, Valkey, React, Node.js, and pnpm fit the target. The selected deployment is one Node process/listener behind Cloudflare Tunnel, not TanStack Start's default opaque Node launcher.

## Validated baseline

| Area | Decision | Validation result |
| --- | --- | --- |
| Runtime | Node.js 24.18.0 LTS; pnpm 11.11.0; TypeScript 5.9.3 | Compatible. Node exceeds Start/Rsbuild/pnpm engine floors. TypeScript 5.9.3 is the conservative first baseline; TypeScript 7 requires a separate compatibility upgrade, not an unreviewed initial install. |
| UI/runtime | React and React DOM 19.2.7 | Compatible with current Start, Query, Router integration, and Pacer peer ranges. Pin React and React DOM to the same patch. |
| Full-stack framework | TanStack Start 1.168.27 with Rsbuild 2.1.5 | Viable with maturity risk. Start is RC. Rsbuild is the directly documented custom-server path and supports a fetch-style Start server entry that a small Node host can forward to. |
| Server ownership | One custom Node `http.Server`; Socket.IO at `/socket.io/`; remaining requests to Start | Required. Socket.IO must attach to the actual production listener. Do not assume Start's default `node .output/server/index.mjs` launcher exposes that object. |
| Server/client execution | Start loaders plus server functions/server-only functions | Compatible. Loaders are isomorphic: they run during SSR and again in the browser on navigation. Database handles, secrets, auth server configuration, and privileged operations must remain behind server-only boundaries. |
| Home data | TanStack Query 5.101.2 plus Router SSR Query integration 1.167.1 | Compatible with corrections. Create one QueryClient per SSR request; call `setupRouterSsrQueryIntegration`; prefetch critical loader data with `ensureQueryData`; read it with `useSuspenseQuery`. Never share one server QueryClient across requests. |
| Query transitions | `placeholderData: keepPreviousData`; `isPlaceholderData` | Required Query v5 API. The removed `keepPreviousData: true` and `isPreviousData` APIs must not be implemented. Every query function forwards Query's `AbortSignal`. |
| Browser pacing | React Pacer 0.22.1 and core Pacer 0.21.1 | Viable with exact pins and corrected APIs. Pacer is beta and only owns the four documented execution-control contracts. |
| Realtime | Socket.IO client/server 4.8.2 | Compatible. It owns authenticated room realtime and WebRTC signaling. CORS is not authorization; connection middleware and every client command still require session, membership, lifecycle, and capability checks. |
| Media | Native `RTCPeerConnection`, public STUN, no TURN | Architecturally valid for the bounded V1 topology. One member watches at most one Stream; a publisher has at most nine subscribers in a full room. A publishing-and-watching browser therefore has at most ten peer connections, and a full room has at most ten directed subscriptions. Reliability remains best effort without TURN. |
| Authentication | Better Auth 1.6.23; Discord only | Compatible with explicit origin/proxy/session configuration. PostgreSQL owns sessions. Seven-day rolling sessions update expiry at most daily; cookie session cache remains off; OAuth tokens are encrypted at rest. |
| Discord without email | Stable-ID placeholder through `mapProfileToUser` | Required to preserve eligibility for phone-only Discord accounts. Use `<discord-id>@discord.placeholder.local`; never display, contact, search, or treat it as verified. Discord provider ID remains the identity anchor. |
| Persistence | Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, `pg` 8.22.0, PostgreSQL | Compatible. Enable Drizzle adapter transactions. Generate Better Auth tables through its CLI, then manage the resulting schema/migrations through Drizzle. Application rows reference Better Auth user IDs. |
| Rate limiting | Valkey plus `ioredis` 5.11.1 for application limits; Better Auth database limiter for auth endpoints | Compatible and simpler than configuring Better Auth secondary storage. Valkey's atomic increment/expiry primitives fit fixed windows. Do not configure Better Auth `secondaryStorage`, because session reads then move to secondary storage even when sessions are duplicated in PostgreSQL. |
| Deployment | Docker Compose on one homelab host; one app origin through Cloudflare Tunnel | Compatible with WebSockets. PostgreSQL and Valkey remain on the private Compose network. Trust the configured public origin and Cloudflare client-IP header only at the known proxy boundary. |

## Required integration contracts

### 1. Start, Rsbuild, and the Node host

The production host is intentionally small:

1. import the Start build's fetch-style request handler;
2. create one Node `http.Server`;
3. attach Socket.IO at its distinct `/socket.io/` path;
4. serve built client assets and forward every other HTTP request to Start;
5. expose one origin through Cloudflare Tunnel.

No Express application, separate signaling service, or second public port is required merely to compose these boundaries. Development must prove that the selected Start/Rsbuild output exposes the documented handler before route/API scaffolding expands.

### 2. TanStack Query SSR

A server-global QueryClient would leak cached data between requests. The router factory therefore creates a fresh QueryClient on every SSR request and installs the Router Query integration. The Home loader blocks on indexable discovery/search and visible Past Streams through `ensureQueryData`; components consume the same query options with `useSuspenseQuery`. Noncritical sections may prefetch and own independent skeleton/error boundaries. Better Auth session state remains outside Query.

### 3. Pacer APIs and teardown

- **Search:** `useDebouncer`, `wait: 250`; input uses `maybeExecute`, Enter uses `flush`, and URL/Query cancellation owns stale work.
- **Direct watch:** one `AsyncRetryer` per explicit watch/manual Retry with `maxAttempts: 4`, `baseWait: 1000`, `maxWait: 4000`, `jitter: 0`. Its abort signal reaches the actual native WebRTC attempt. Cancellation aborts, closes the peer connection, and discards the single-use retryer.
- **Preview upload:** `useAsyncThrottler`, `wait: 120000`, leading and trailing. Teardown calls both `cancel()` and `abort()` and passes `getAbortSignal()` to the upload request.
- **Typing:** `useThrottler`, not `useThrottledCallback`, because empty input/blur/send/leave/disconnect must cancel pending trailing work.

Pacer never owns room expiry, reconnect grace, abuse limits, persisted jobs, sanctions, or membership lifecycle.

### 4. Auth, sessions, and proxy trust

Better Auth configuration must include:

- Drizzle adapter `transaction: true`;
- `session.expiresIn: 604800` and `session.updateAge: 86400`;
- cookie session cache disabled;
- `account.encryptOAuthTokens: true`;
- exact `BETTER_AUTH_URL`/trusted origin matching the tunneled public origin;
- secure production cookies;
- client IP derived from the known Cloudflare proxy header only after the request crosses the configured tunnel boundary;
- Discord's non-routable stable-ID email fallback when email is absent.

Do not configure Better Auth secondary storage just to reuse Valkey. Its documented behavior moves session reads to secondary storage. Keeping auth rate limits in Better Auth's database storage and application abuse limits in Valkey preserves the simpler authority split: PostgreSQL loss is durable-state failure; Valkey loss is disposable-policy-state failure, not mass logout.

### 5. Native WebRTC signaling authorization

Socket.IO exchanges only offer, answer, and ICE metadata. Every command is acknowledged and authorized against:

- the authenticated, non-sanctioned Account connection;
- its current admitted Room Membership;
- the current Stream session;
- the caller's one active remote Stream Subscription or authority to publish that Stream;
- current room/stream lifecycle state.

Use opaque application Stream/session IDs, validate payload size and shape before forwarding, and never accept an arbitrary destination socket/Account ID as authority. Displacement, leave, admission loss, Stream stop, Room end, sanction, and watch cancellation stop further signaling and instruct conforming clients to close affected connections immediately.

Direct P2P has two residual boundaries that application code cannot erase: ICE candidates may reveal network-address information to the selected peer, and a server cannot cryptographically retract media already received by a browser. No UI or documentation may imply stronger revocation.

## Failure behavior

| Failure | Required behavior |
| --- | --- |
| PostgreSQL unavailable | Readiness fails; reject auth and durable mutations. Do not pretend a write succeeded. |
| Valkey unavailable | Fail closed for documented rate-limited application mutations with a recoverable service-unavailable response. Read-only pages and already-established direct media may remain. A restart may reset windows. |
| Socket.IO reconnect | Preserve the documented 45-second membership grace only. Close media immediately; reclaimed membership requires explicit Watch/Start again. |
| STUN/ICE failure | Keep chat/presence available, return watched tile to Preview after bounded retries, and expose manual Retry/compatibility guidance. No silent TURN fallback. |
| Pacer cancellation | Cancel timers and abort the underlying work; UI state alone is not cancellation. |
| Cloudflare/public-origin mismatch | OAuth and WebSocket startup should fail visibly; do not broaden trusted origins or proxy headers as a workaround. |

## Launch evidence still required

Documentation validation establishes compatibility, not production capacity. Before launch, exercise:

1. **Single-listener integration:** SSR, static assets, Better Auth callbacks, and Socket.IO upgrade on the tunneled production-shaped Node host.
2. **Bounded load:** 25 simultaneous full rooms, 250 Socket.IO connections, up to 250 directed subscriptions, representative chat/presence/signaling acknowledgements, forced reconnects, and tunnel restart.
3. **Real-network ICE matrix:** supported desktop/mobile watchers across representative home, mobile, corporate, and restrictive NATs; measure the documented no-TURN failure envelope rather than promising universal connectivity.
4. **Auth boundary:** Discord callback origin, phone-only/no-email account, seven-day rolling session, sign-out/revocation, admin allowlist, account sanction/deletion, token encryption, and spoofed proxy-header rejection.
5. **Authority failures:** PostgreSQL down, Valkey down/restart, STUN unavailable, Socket.IO disconnect/reclaim/expiry, Stream stop during negotiation, and room end during active media.
6. **Backup/restore:** encrypted PostgreSQL backup and a successful documented restore. Valkey restoration is intentionally unnecessary.

## Rejected additions

- **PeerJS/PeerServer:** removed; it duplicated signaling and required custom admission security.
- **TURN/SFU/media server:** outside the accepted V1 reliability/capacity boundary; add only if measured direct-connect failures or fan-out requirements justify a new media-topology ADR.
- **Redis/Valkey session authority:** rejected; it couples disposable rate-limit state to authentication continuity.
- **Separate API server, Express shell, queue, background worker, global client state store, second ORM/auth cache:** no documented V1 contract requires them.
- **Loose `latest` dependency ranges:** rejected for Start RC and Pacer beta integration.

## Primary sources

### TanStack and runtime

- [TanStack Start overview](https://tanstack.com/start/latest/docs/framework/react/overview)
- [TanStack Start execution model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model)
- [TanStack Start hosting/custom Node guidance](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- [TanStack Router Query integration](https://tanstack.com/router/latest/docs/integrations/query)
- [TanStack Query advanced SSR](https://tanstack.com/query/v5/docs/framework/react/guides/advanced-ssr)
- [TanStack Query v5 migration guide](https://tanstack.com/query/v5/docs/framework/react/guides/migrating-to-v5)
- [TanStack Pacer `useDebouncer`](https://tanstack.com/pacer/latest/docs/framework/react/reference/functions/useDebouncer)
- [TanStack Pacer `useThrottler`](https://tanstack.com/pacer/latest/docs/framework/react/reference/functions/useThrottler)
- [TanStack Pacer `useAsyncThrottler`](https://tanstack.com/pacer/latest/docs/framework/react/reference/functions/useAsyncThrottler)
- [TanStack Pacer `AsyncRetryer`](https://tanstack.com/pacer/latest/docs/reference/classes/AsyncRetryer)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [pnpm installation/runtime requirements](https://pnpm.io/installation)

### Auth and data

- [Better Auth TanStack Start integration](https://www.better-auth.com/docs/integrations/tanstack)
- [Better Auth Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle)
- [Better Auth session management](https://www.better-auth.com/docs/concepts/session-management)
- [Better Auth OAuth: providers without email](https://www.better-auth.com/docs/concepts/oauth#handling-providers-without-email)
- [Better Auth rate limiting](https://www.better-auth.com/docs/concepts/rate-limit)
- [Better Auth secondary storage](https://www.better-auth.com/docs/concepts/database#secondary-storage)
- [Drizzle PostgreSQL guide](https://orm.drizzle.team/docs/get-started-postgresql)
- [Valkey `INCR`](https://valkey.io/commands/incr/)

### Realtime, media, and deployment

- [Socket.IO server initialization](https://socket.io/docs/v4/server-initialization/)
- [Socket.IO middlewares](https://socket.io/docs/v4/middlewares/)
- [MDN `RTCPeerConnection`](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)
- [MDN WebRTC signaling and video calling](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling)
- [RFC 8445: Interactive Connectivity Establishment](https://www.rfc-editor.org/rfc/rfc8445)
- [RFC 8489: STUN](https://www.rfc-editor.org/rfc/rfc8489)
- [Cloudflare WebSocket proxy support](https://developers.cloudflare.com/network/websockets/)

### Version records reviewed

- [TanStack Start registry record](https://registry.npmjs.org/@tanstack/react-start/latest)
- [React registry record](https://registry.npmjs.org/react/latest)
- [TanStack Query registry record](https://registry.npmjs.org/@tanstack/react-query/latest)
- [TanStack Pacer registry record](https://registry.npmjs.org/@tanstack/react-pacer/latest)
- [Socket.IO registry record](https://registry.npmjs.org/socket.io/latest)
- [Better Auth registry record](https://registry.npmjs.org/better-auth/latest)
- [Drizzle ORM registry record](https://registry.npmjs.org/drizzle-orm/latest)
- [Rsbuild registry record](https://registry.npmjs.org/@rsbuild/core/latest)
