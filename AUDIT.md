# BhayanakCast Production Audit

Date: 2026-06-28
Scope: full end-scale production readiness, not v1 acceptance.
Method: read project documentation and inspected the current source, routes, server functions, realtime handlers, schema, config, and tests. This replaces the previous `AUDIT.md`.

## Verdict

BhayanakCast is a solid vertical-slice prototype with real PostgreSQL persistence, Better Auth, Drizzle schema/migrations, a shared-port production server, and a broad Socket.IO server surface. It is not production-complete for the documented product, and it is further from full end-scale production.

The largest gap is not schema or backend domain code. The largest gap is end-to-end product wiring: frontend pages render many production-looking surfaces, but major documented controls are not connected to the realtime/API operations that already exist server-side. Admin operations, discovery live updates, chat UI, room member state, duplicate-client takeover, reconnect grace, empty-room expiry, and the documented Playwright catalog are incomplete.

For full-scale production, the system also lacks horizontal realtime architecture, dependency health checks, durable thumbnail/report handling strategy beyond current split, scheduled aggregation, backup/retention/DR policy, operational monitoring, and security hardening around infrastructure and sessions.

## Documentation source of truth read

Documentation inspected:

- `CONTEXT.md` — product glossary and canonical product language.
- `README.md` — runtime services, setup, quality gates.
- `docs/README.md` — documentation source-of-truth order.
- `docs/configuration.md` — required/optional environment variables and deployment boundaries.
- `docs/schema.md` — product tables and live-only state boundaries.
- `docs/drizzle-schema.md` — exact Drizzle schema contract, constraints, indexes, migration order.
- `docs/routes.md` — page/API route contract and UI/data expectations.
- `docs/socket-events.md` — Socket.IO command/broadcast catalog, DTOs, ack shape, error codes.
- `docs/testing.md` — required Vitest and Playwright coverage catalog.
- `docs/observability.md` — structured logging requirements and sensitive-data exclusions.
- `docs/implementation-plan.md` — intended vertical slice order.
- `docs/design/README.md` — visual/product reference and canonical deltas from prototype.
- `docs/adr/0001-peer-to-peer-media.md` — P2P WebRTC, room cap, stream thumbnail semantics.
- `docs/adr/0002-auth-and-orm.md` — Better Auth, Drizzle, admin allowlist, password hashes, startup migrations.
- `docs/adr/0003-socket-io-room-signaling.md` — Socket.IO signaling, persistence/live-state boundary, scaling caveat.
- `docs/adr/0004-validation-and-testing.md` — Zod/Vitest/Playwright and test-only auth boundary.
- `docs/adr/0005-single-origin-start-and-socket-io.md` — TanStack Start + Socket.IO same origin/port.
- `docs/adr/0006-v1-data-model.md` — rooms, memberships, streams, chat, reports, sanctions, aggregates.
- `docs/adr/0007-realtime-protocol.md` — join ordering, discovery room, stream/watch/signaling semantics.
- `docs/adr/0008-v1-ui-flows.md` — create room, room mosaic, reports, host controls, admin operations.
- `docs/adr/0009-ui-implementation-stack.md` — Tailwind v4/shadcn UI, visual fidelity, motion, accessibility.
- `docs/adr/0010-valkey-rate-limiting.md` — rate-limited abuse surfaces and default limits.

## Requirement matrix

| Domain | Documented requirement | Current status | Evidence |
| --- | --- | --- | --- |
| Runtime services | Node/pnpm app with PostgreSQL and Valkey; app exposes only one public port. | Partially met. | `docker-compose.yml` defines app/postgres/valkey; app maps `${PORT:-3000}:3000`, but postgres and valkey also expose host ports `5432` and `6379`, conflicting with the docs' internal-only boundary. |
| Startup migrations | App container runs Drizzle migrations on startup and fails instead of serving stale schema. | Mostly met. | `scripts/start.mjs` calls `migrate(db, { migrationsFolder })` before creating/listening on the HTTP server. |
| Auth | Better Auth with Discord provider, Drizzle adapter, TanStack Start cookies. | Met for core auth. | `src/lib/auth.ts` wires Better Auth, Drizzle adapter, schema, and TanStack cookies; `src/routes/api/auth/$.ts` forwards GET/POST to `auth.handler`. |
| Admin identity | Platform admins identified by static Discord ID allowlist. | Met for checks, incomplete for UX. | `src/lib/admin.ts` resolves Discord `account.accountId` and checks `ADMIN_DISCORD_IDS`; `/admin` uses it. App shell does not reliably hide/show admin nav from server-side admin loader. |
| Environment contract | Required vars mirror `.env.example`. Secrets never exposed to browser. | Mostly met. | `.env.example` includes documented vars. Need production secret enforcement and deployment-time validation beyond local config tests. |
| Database schema | Product schema includes rooms, memberships, bans, streams, chat, reports, sanctions, user facts, pair facts with constraints/indexes. | Strongly met. | `src/db/schema.ts` contains Better Auth tables plus product tables/enums/checks/indexes; migrations exist under `src/db/migrations/`. |
| Room creation | Public/private rooms with name/category/up to five tags; private password required and hashed. | Mostly met. | `src/lib/rooms.ts` validates and hashes passwords; `src/lib/room-actions.ts` exposes create-room server function. Room name lower bound differs at action layer (`min(1)`) versus product (`3`). |
| Discovery | Public live rooms and past streams; private rooms listed with privacy projection; live updates over `discovery` Socket.IO room. | Partially met. | `src/lib/discovery.ts` loads live/ended DB-backed rooms; `src/routes/index.tsx` renders active/past sections. Client does not join `discovery`, so updates require reload. Private projection is UI-level and incomplete. |
| Room join lifecycle | Auth, full suspension, room state, room ban, password, capacity, reconnect slot ordering; capacity 10; empty grace revive/end; host handoff after grace. | Partially met. | `src/lib/rooms.ts` implements auth caller boundary, sanctions, bans, password, capacity, empty_grace revive, and host handoff on leave. Missing 60s reconnect grace and 5-minute empty-grace expiry to ended. |
| Duplicate active room client | One active socket per account per room; new client requires confirmation/takeover. | Not met end to end. | Server tracks sockets but no documented duplicate warning/confirm/takeover UI; room page does not implement the confirmation flow. |
| Chat | Validate, persist, then broadcast; no reconnect backfill; transcript retained for host/admin after room ends. | Backend mostly met; UI incomplete. | `src/lib/realtime.ts` persists `chatMessages` then emits `chat:message`; transcript API exists. `src/routes/rooms/$roomId.tsx` does not provide a real chat message list/send flow. |
| Streams | Chromium desktop stream start gate; one active stream per member; start/stop DB rows; watch/unwatch P2P signaling; retry UI; no media through server. | Partially met. | `src/lib/streams.ts` enforces Chromium-ish user-agent and active stream uniqueness. `src/components/room-stream-panel.tsx` implements screen capture/WebRTC/signaling pieces. Room mosaic and documented tile/member behavior are incomplete. |
| Stream thumbnails | Latest blurred preview every ~2 minutes, 100 KB cap, latest active thumbnail deleted on stream end; report snapshot persisted. | Partially met. | `src/lib/streams.ts` caps and rate-limits thumbnails; `src/lib/thumbnail-store.ts` is in-memory; reports persist thumbnail bytes. Restart loses active previews, acceptable for v1 wording but not robust production UX. |
| Reports | User reports for account/room/stream/chat; stream reports freeze latest thumbnail; rate-limited. | Backend mostly met; UI incomplete. | `src/lib/moderation.ts` creates reports and snapshots thumbnails; realtime has `report:create`; frontend report entry points are missing or decorative. |
| Host moderation | Host can stop streams, ban/clear room bans; non-host forbidden. | Backend mostly met; UI incomplete. | `src/lib/realtime.ts` has `host:stopStream`, `host:banMember`, `host:clearBan`; room settings/moderation UI is not implemented to the documented level. |
| Platform sanctions | Admin can create/lift stream/chat/room/full sanctions; sanctioned users see stable blocked actions. | Backend mostly met; admin UI incomplete. | `src/lib/moderation.ts` and realtime admin handlers support sanctions; `/admin` only shows metric cards and placeholder sections. |
| Admin dashboard | Single `/admin` page with Reports, Live Rooms, Sanctions, Metrics tabs and `admin:join` live updates. | Not met. | `src/routes/admin.tsx` renders metrics and placeholder live-room panel only; no tabs, reports, sanction table/actions, live room end controls, or `admin:join` client. |
| Profiles/aggregates | Public profile with aggregate stats, top co-users, rooms/history, `lastUpdatedAt`; nightly facts. | Partially met. | `src/lib/aggregates.ts` computes and reads facts; profile routes render stats and co-users. No scheduler/cron calls `recomputeDailyFacts`; room history is missing. |
| Observability | Structured logs for auth failures, room lifecycle, stream events, reports, sanctions, bans, rate-limit rejects, unexpected socket errors; no sensitive logs. | Partially met. | `src/lib/logger.ts` exists with redaction tests; many domain services call `logEvent`. Missing comprehensive coverage for all documented events and no metrics/tracing/alerts for production ops. |
| Health | Production health should prove service dependencies, not just process liveness. | Not production-ready. | `src/routes/api/health.ts` returns static `createHealthPayload()`; no DB/Valkey check. Docs only specify route, but production scope needs dependency checks. |
| Testing | Vitest unit/integration and Playwright Chromium e2e for documented scenarios. | Backend fair; e2e severely incomplete. | `src/lib/*.test.ts` covers many domain paths. `e2e/app.spec.ts` has only three shallow page-render tests versus the large `docs/testing.md` catalog. |
| UI implementation | Tailwind v4 + shadcn, prototype visual fidelity, motion, accessibility, dark dense UI. | Partially met. | `styles.css` and components provide a dark polished look. Many values are hard-coded in route components instead of centralized theme tokens; motion/accessibility coverage is incomplete. |
| Horizontal scale | Single-node launch can use in-memory Socket.IO adapter; horizontal scale needs shared adapter. | Not met for full end-scale production. | ADR explicitly leaves shared adapter as future decision; current realtime state uses in-memory maps. |
| Data retention/DR | Past streams/transcripts/reports/sanctions retained until explicit deletion; full production needs backup/retention policy. | Not specified/implemented. | Docs state no automatic expiry for v1 but do not define production retention, deletion, backup, restore, or legal/privacy operations. |

## What is hooked up and working

### Core backend foundation

- `src/db/schema.ts` is the strongest part of the project. It includes Better Auth tables and product tables for rooms, memberships, room bans, stream sessions, chat messages, reports, platform sanctions, user daily facts, and user-pair facts.
- Drizzle migrations are present and `scripts/start.mjs` applies them before serving production traffic.
- `src/db/index.ts` creates a PostgreSQL pool and Drizzle client. It is minimal and works for local/single-node use.
- `src/lib/auth.ts` correctly wires Better Auth to Drizzle and TanStack Start cookies.
- `src/routes/api/auth/$.ts` correctly exposes the Better Auth catch-all route.

### Room and moderation services

- `src/lib/rooms.ts` implements room creation, private password hashing/verification, join, leave, room bans, capacity, empty-grace state transition on last leave, host handoff on normal leave, and transcript authorization.
- `src/lib/moderation.ts` implements room bans, clear bans, sanctions, lift sanctions, report creation, thumbnail snapshot capture, and report thumbnail reads.
- `src/lib/streams.ts` implements active stream start/stop, one-active-stream rule, Chromium-ish stream-start gate, thumbnail size/rate-limit handling, and thumbnail cleanup.
- `src/lib/rate-limit.ts` defines the documented core abuse-surface rate limits: room creation, chat, reports, thumbnails, stream commands, private-room password attempts.

### Realtime server

`src/lib/realtime.ts` is broad and substantially wired. It registers handlers for:

- `discovery:join`, `discovery:leave`
- `room:create`, `room:join`, `room:leave`
- `chat:send`
- `stream:start`, `stream:stop`, `stream:thumbnail`
- `watch:start`, `watch:stop`
- `signal:offer`, `signal:answer`, `signal:iceCandidate`
- `host:stopStream`, `host:banMember`, `host:clearBan`
- `report:create`
- `admin:join`, `admin:endRoom`, `admin:resolveReport`, `admin:createSanction`, `admin:liftSanction`

That means the server is ahead of the client in several areas. Many missing product behaviors are missing because no UI calls these handlers, not because the backend handler does not exist.

### Routes and frontend shell

- File routes match the documented route shape: root, home, room, profile, public user profile, admin, auth, health, transcript, stream thumbnail, report thumbnail, dev/test session routes.
- `src/routes/index.tsx` uses DB-backed discovery data and implements room creation plus private room password dialog.
- `src/routes/rooms/$roomId.tsx` loads a DB-backed room summary and embeds `RoomStreamPanel`.
- `src/components/room-stream-panel.tsx` contains the strongest client-side realtime implementation: screen capture, stream start/stop, thumbnail emit/upload, watch start/stop, peer connection offer/answer/ICE handling, and bounded retry constants.
- `src/routes/profile.tsx` and `src/routes/users/$userId.tsx` use DB-backed aggregate profile data.
- `src/routes/admin.tsx` enforces platform-admin access before rendering dashboard content.

## Major production gaps

### P0 — Blocks documented product behavior

#### 1. Admin dashboard is mostly not implemented

Docs require `/admin` tabs for Reports, Live Rooms, Sanctions, Metrics; live admin updates via `admin:join`; report review; sanction create/lift; ending live rooms.

Current state:

- `/admin` loads admin metrics and renders metric cards.
- No Reports tab.
- No Live Rooms tab with end-room controls.
- No Sanctions tab.
- No report resolution UI.
- No sanction create/lift UI.
- No `admin:join` client call.

Backend handlers exist, but production admin work cannot be performed from the UI.

#### 2. Room page is not the documented room product

Docs require a live member mosaic, one tile per admitted member, active stream previews, subscribed stream media tiles, non-streaming member tiles, people/chat panels, host moderation modal, report dialogs, leave flow, duplicate-client takeover, and room state handling.

Current state:

- Room page shows header summary and visual panels.
- `RoomStreamPanel` provides stream/WebRTC mechanics, but the full room mosaic/member model is not rendered from live canonical member data.
- Chat button and side panel are not a real chat product.
- Leave button/control is not wired as documented.
- Report controls are absent or decorative.
- Host room settings/ban controls are absent from the documented UI.
- Full/banned/ended/reconnect/takeover states are not presented end to end.

#### 3. Discovery does not live-update

Docs require home/admin live lists to join the Socket.IO `discovery` room and receive created/updated/revived/ended broadcasts.

Current state:

- Server emits discovery broadcasts.
- `src/routes/index.tsx` loads discovery once through a server function.
- No client joins `discovery`; no cache update path exists for live changes.

Users will see stale discovery until navigation/reload.

#### 4. Empty-room grace never expires to ended

Docs define a five-minute Empty Room Grace Period after the last member leaves. If nobody rejoins, the room ends and becomes a Past Stream.

Current state:

- `leaveRoom` moves a room to `empty_grace` when the last active membership closes.
- Join can revive an `empty_grace` room.
- No timer, scheduler, background sweep, or startup reconciliation ends rooms after five minutes.

Rooms can remain `empty_grace` indefinitely.

#### 5. Reconnect grace and duplicate-client takeover are missing

Docs require a 60-second reconnect grace slot and a server-confirmed duplicate active room client takeover flow.

Current state:

- Room membership is DB append-only and live sockets are tracked in memory.
- There is no persisted/transient reconnect slot accounting surfaced by the join gate.
- There is no client warning/confirm/retry takeover state before rendering live room UI.

This breaks capacity semantics, host handoff timing, and multi-device correctness.

#### 6. Aggregates are not scheduled

Docs require nightly aggregate computation and `lastUpdatedAt` stats for profiles/admin.

Current state:

- `recomputeDailyFacts(day)` exists in `src/lib/aggregates.ts`.
- Profile/admin readers exist.
- No scheduler, cron, startup job, CLI, or deployment hook invokes recomputation.

Profiles can remain empty/stale forever unless tests or manual scripts seed facts.

#### 7. Playwright e2e coverage is far below documented acceptance

Docs list extensive Chromium e2e scenarios: auth shell, discovery, create/join, public/private lifecycle, room capacity, reconnect grace, streaming, thumbnails, host controls, reports, sanctions, profile/admin, accessibility, reduced motion.

Current state:

- `e2e/app.spec.ts` contains only three shallow page-render tests.
- Most route/component tests are Vitest source-string assertions, not runtime behavior.
- Backend Vitest coverage is reasonable, but production product flows are not protected.

### P1 — Blocks production hardening

#### 8. Health endpoint is static

`/api/health` returns a static payload. It does not check PostgreSQL, Valkey, migration state, or realtime readiness. This is insufficient for production orchestration and alerting.

#### 9. Valkey client opens a socket per command

`src/lib/rate-limit.ts` implements RESP over raw TCP/TLS and opens a new socket per command batch. This is simple and testable but inefficient under production chat/thumbnail/report load. Use a real pooled Redis/Valkey client or a tiny connection pool before sustained production traffic.

#### 10. Docker Compose exposes private dependencies on host ports

Docs say only the app port is publicly exposed and PostgreSQL/Valkey are backend-internal. `docker-compose.yml` exposes `5432:5432` and `6379:6379`. That may be useful locally, but it should not be the production compose/deployment default.

#### 11. In-memory realtime state prevents horizontal scale

ADR-0003 explicitly says multi-server deployment needs a shared Socket.IO adapter. Current code uses in-memory maps for presence, user sockets, stream sockets, and thumbnails. This is acceptable single-node; it is not full end-scale production.

#### 12. Active thumbnails are volatile

Docs allow latest stream preview thumbnails to be in-memory for v1, and reports persist frozen snapshots. For production UX, active thumbnail loss on restart degrades discovery/preview/report context. Decide whether this remains acceptable or move latest previews to Valkey/object storage with strict TTL and privacy controls.

#### 13. Missing backup, restore, retention, and deletion policy

Docs intentionally state v1 does not auto-expire product history. Full production needs explicit policy for:

- PostgreSQL backups and restore tests.
- Report thumbnail retention.
- Transcript retention and access logs.
- Sanction/report deletion or legal hold.
- Account deletion/anonymization behavior.

#### 14. Observability is logs-only and incomplete for ops

Docs define logs-only for v1, but full production needs at least operational checks around:

- Socket connection counts and room counts.
- Rate-limit reject rate.
- WebRTC setup failure reports.
- Thumbnail upload failures.
- Auth callback failures.
- Admin moderation actions.

The current logger/redaction base is fine; coverage and aggregation are not production-grade.

#### 15. Production auth/session security needs hardening review

Better Auth is wired, but production readiness still needs verification of:

- Secure cookie settings behind tunnel/proxy.
- Trusted origin/base URL correctness.
- Secret length enforcement at startup.
- Discord OAuth callback origin in every deployed environment.
- Test/dev auth bypass impossible in production.

Existing tests cover some config/auth bypass behavior, but deployment enforcement must be explicit.

### P2 — Product quality and maintainability gaps

#### 16. UI styling bypasses the documented token strategy

ADR-0009 says Tailwind v4 theme tokens should encode colors, typography, shadows, radii, and motion rather than scattering one-off values. Current pages contain many hard-coded utility colors/shadows. Visual direction is close, but maintainability is weak.

#### 17. Home card data has hard-coded or fake presentation details

Known frontend gaps include:

- Capacity display uses hard-coded card values instead of the canonical room capacity.
- Past stream duration is hard-coded.
- Avatar stacks are generated from initials rather than privacy-aware participant projections.
- Tag/category filtering exists, but richer documented card privacy details are incomplete.

#### 18. Profile pages omit room history

Docs mention profile summary, aggregate facts, rooms, and social stats. Current profile pages show aggregate cards and co-users but not a room/past-stream history list.

#### 19. Accessibility and reduced-motion are not proven

Docs require accessibility and reduced-motion behavior. There are isolated UI tests, but no systematic a11y or reduced-motion e2e coverage.

## Tests and verification assessment

### Strong areas

- Backend/lib Vitest coverage is meaningful for core domain logic.
- Schema tests validate table/index/constraint invariants.
- Moderation tests cover room bans, sanctions, reports, thumbnail snapshots.
- Streams tests cover active stream rules and thumbnail limits.
- Realtime tests cover several socket event paths.
- Logger tests cover secret redaction.
- Env/auth tests cover pieces of configuration and test auth gating.

### Weak areas

- Playwright coverage is nearly absent relative to `docs/testing.md`.
- Frontend route tests often assert source strings instead of user-visible behavior.
- No production Valkey adapter test.
- No empty-grace expiry test because expiry is not implemented.
- No reconnect grace test because reconnect grace is not implemented.
- No duplicate-client takeover test because takeover is not implemented.
- No admin workflow e2e tests.
- No private room password modal e2e with real Socket.IO join rejection.
- No stream watch retry/recovery e2e.
- No accessibility/reduced-motion e2e.

## Production readiness checklist

### Must finish before claiming documented product complete

- Implement real admin dashboard tabs and actions.
- Wire admin page to `admin:join` and live updates.
- Build room chat UI on `chat:send`/`chat:message`.
- Render live room members and stream tiles from canonical room state.
- Wire Leave, Watch/Stop Watching, report dialogs, and host moderation controls.
- Implement duplicate-client warning/confirmed takeover flow.
- Implement 60-second reconnect grace semantics.
- Implement five-minute empty-grace expiry to ended/past stream, including restart reconciliation.
- Schedule aggregate recomputation and document its deployment trigger.
- Join `discovery` from the home page and update visible rooms live.
- Replace shallow e2e suite with the documented Playwright catalog, starting with auth, discovery, create/join, private password, room lifecycle, admin, and reports.

### Must finish before full-scale production

- Choose and implement shared Socket.IO adapter strategy for horizontal scale.
- Move in-memory presence/stream socket state to a design that survives or coordinates across nodes, or explicitly constrain production to one node with operational guardrails.
- Decide active thumbnail durability/TTL strategy.
- Add dependency health checks for PostgreSQL and Valkey.
- Stop exposing PostgreSQL/Valkey host ports in production deployment.
- Add backup/restore, retention, deletion/anonymization, and incident response docs.
- Add structured operational dashboards/alerts or equivalent log-based alert queries.
- Harden production env validation and proxy/cookie/OAuth settings.
- Load-test room join, chat, thumbnails, and signaling under room cap and expected room count.
- Verify WebRTC behavior across Chromium desktop networks and failure modes.

## File-level notes

### `src/lib/realtime.ts`

Good: broad Socket.IO command coverage, Zod validation, stable ack shape, sanctions/rate limits on sensitive actions, room-scoped signaling authorization.

Gaps:

- No documented `system:ready` / `system:error` readiness lifecycle.
- No complete active-client takeover protocol.
- No reconnect grace accounting.
- In-memory maps prevent horizontal scaling.
- Client coverage is much thinner than server coverage.

### `src/lib/rooms.ts`

Good: core room create/join/leave mechanics, password hashing, capacity lock, host handoff, transcript authorization.

Gaps:

- Empty grace starts but does not expire.
- Host handoff happens on normal leave, but reconnect-grace-driven host handoff is missing.
- Create-room action allows one-character names before service validation catches product lower bound; align validation for better UX.

### `src/lib/streams.ts` and `src/components/room-stream-panel.tsx`

Good: browser gate, screen capture, stream start/stop, thumbnail interval constants, watch retry constants, signaling mechanics.

Gaps:

- Stream UI is isolated from a full canonical room mosaic.
- Watch/subscription state is not integrated with all documented tile states.
- Thumbnail path is split between Socket.IO and HTTP route; ensure only one production path is canonical or document both.

### `src/routes/index.tsx`

Good: real discovery loader, create room dialog, private password dialog, public/past room sections.

Gaps:

- No live discovery Socket.IO updates.
- Some display values are hard-coded/fake.
- Private room privacy projection should be enforced by data DTOs, not only card rendering.

### `src/routes/rooms/$roomId.tsx`

Good: authenticated loader and room summary shell.

Gaps:

- Not the documented room product yet.
- Lacks real chat/member/report/host settings flows.
- Lacks duplicate-client/reconnect/ended/full/banned UI states.

### `src/routes/admin.tsx`

Good: admin allowlist enforcement and metrics load.

Gaps:

- Missing nearly all documented operational admin functionality.

### `src/lib/aggregates.ts`

Good: aggregate computation and readers exist.

Gap: no scheduled execution path.

### `src/routes/api/health.ts`

Good: route exists.

Gap: health is static and does not prove dependencies.

### `docker-compose.yml`

Good: app/postgres/valkey services exist with app dependency ordering.

Gap: production boundary mismatch because database and Valkey ports are exposed to host.

## Recommended execution order

1. Finish documented UI wiring before adding infrastructure complexity: admin operations, room chat/member/mosaic/host/report flows, discovery live updates.
2. Implement lifecycle correctness: reconnect grace, duplicate-client takeover, empty-grace expiry and restart sweep.
3. Add aggregate scheduling.
4. Replace shallow Playwright tests with the documented user flows.
5. Harden production runtime: health checks, Valkey client/pooling, Docker exposure, env validation, backups/retention.
6. Only then decide horizontal scale: shared Socket.IO adapter plus cross-node state design, or single-node production with explicit limits.

## Bottom line

Current code is beyond a mock: persistence, auth, schema, rate limits, moderation services, and much of realtime server behavior are real. It is not full production scope. The remaining work is primarily product integration and operational hardening, not greenfield architecture.
