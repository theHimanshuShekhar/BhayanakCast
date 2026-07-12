# ADR 0105: Pin the validated V1 technology baseline

- **Status:** Accepted
- **Date:** 2026-07-11
- **Supersedes in part:** ADR 0022, ADR 0092, ADR 0099 where implementation wording conflicts

## Context

The rewrite retains the V1 product contract but has no code compatibility constraint. A current-library review found the selected technologies compatible for the single-node, 250-member launch target, with several integration and API corrections. TanStack Start remains a Release Candidate and TanStack Pacer remains beta, so an unbounded `latest` install would make the baseline non-reproducible.

## Decision

### Runtime and web application

Start implementation from this exact reviewed baseline and commit the pnpm lockfile:

| Boundary | Initial exact version |
| --- | --- |
| Node.js | 24.18.0 LTS |
| pnpm | 11.11.0 |
| TypeScript | 5.9.3 |
| React / React DOM | 19.2.7 |
| `@tanstack/react-start` | 1.168.27 |
| `@rsbuild/core` | 2.1.5 |
| `@tanstack/react-query` | 5.101.2 |
| `@tanstack/react-router-ssr-query` | 1.167.1 |
| `@tanstack/react-pacer` | 0.22.1 |
| `@tanstack/pacer` | 0.21.1 |
| Socket.IO client/server | 4.8.2 |
| Better Auth packages | 1.6.23 |
| `drizzle-orm` | 0.45.2 |
| `drizzle-kit` | 0.31.10 |
| `pg` | 8.22.0 |
| `ioredis` | 5.11.1 |

Pin mutually coupled packages exactly and update them only through a focused compatibility change. TypeScript 5.9.3 is a conservative baseline, not a claim that TypeScript 7 is broken; evaluate that major independently after Start, Router, Query, React types, and Rsbuild pass the application checks.

Use TanStack Start's Rsbuild plugin and documented custom-server output. A small production Node host owns one `http.Server`, attaches Socket.IO at `/socket.io/`, serves built client assets, and forwards all remaining requests to Start's fetch-style server entry. Cloudflare Tunnel exposes only that single application origin. PostgreSQL and Valkey remain private Compose services.

Create a fresh QueryClient for every SSR request and call `setupRouterSsrQueryIntegration` in the router factory. Home loaders prefetch critical data with `ensureQueryData`; components read it with `useSuspenseQuery`. TanStack Query v5 previous-result retention uses `placeholderData: keepPreviousData` and `isPlaceholderData`, not removed `keepPreviousData: true` or `isPreviousData` options.

### Authentication and persistence

Better Auth owns Discord OAuth and sessions. PostgreSQL remains authoritative for users, accounts, sessions, and auth rate-limit rows; do not configure Better Auth `secondaryStorage`, because session reads move to secondary storage when it exists. Use Better Auth's database rate limiter for auth endpoints. Valkey remains disposable, authoritative fixed-window state only for the documented application abuse limits.

Configure:

- Drizzle adapter `transaction: true`;
- `session.expiresIn: 604800`, `session.updateAge: 86400`, and cookie cache disabled;
- `account.encryptOAuthTokens: true`;
- the public `BETTER_AUTH_URL`, trusted origin, secure cookie behavior, and Cloudflare client-IP header from deployment configuration rather than request input;
- Discord `mapProfileToUser` fallback email `<discord-id>@discord.placeholder.local` when Discord omits email. Discord provider ID remains the identity anchor; this non-routable placeholder is never displayed, searched, contacted, or treated as verified.

Generate Better Auth schema through its CLI, then manage the resulting PostgreSQL schema and migrations through Drizzle. Application tables reference Better Auth user IDs; no parallel session or identity store is introduced.

### Client execution control

Keep Pacer narrowly scoped and exact-version pinned:

- Home search uses `useDebouncer` with `wait: 250`; URL navigation and Query cancellation own stale-result protection.
- Every explicit watch or manual-retry cycle creates one `AsyncRetryer` with `maxAttempts: 4`, `baseWait: 1000`, `maxWait: 4000`, and `jitter: 0`. Cancellation calls `abort()`, discards that single-use instance, and closes the native `RTCPeerConnection`; abort does not reset an instance for reuse.
- Preview upload uses `useAsyncThrottler` with `wait: 120000`, `leading: true`, and `trailing: true`. Teardown calls both `cancel()` and `abort()` and passes `getAbortSignal()` to the actual upload.
- Typing presence uses `useThrottler`, not `useThrottledCallback`, so pending trailing work can be cancelled on empty input, blur, send, leave, or disconnect.

Client pacing never replaces server timers, validation, lifecycle, or rate limits.

## Consequences

- The retained stack is viable without adding a second cache, job queue, SFU, TURN service, ORM, auth layer, or client state framework.
- Start and Pacer maturity risk is contained by exact pins, a committed lockfile, and focused behavior checks before upgrades.
- A Valkey restart may reset application rate-limit windows but cannot destroy sessions or persisted product data.
- Rate-limited application mutations fail closed with a recoverable service-unavailable response when Valkey cannot enforce policy; read-only pages and already-established direct media are not stopped solely by a Valkey outage.
- PostgreSQL backups and restore drills remain launch requirements; Valkey persistence is not.
