# Home Route Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Deliver the complete `/` Home route, the smallest real `/rooms/:roomId` boundary required for room navigation/OAuth/admission/creator entry, and the smallest real `/users/:userId` boundary required for Public Profile search-result navigation.

**Architecture:** Build one TanStack Start application on the custom Node listener required by ADR 0105. Keep `src/routes/index.tsx`, `src/routes/rooms/$roomId.tsx`, and `src/routes/users/$userId.tsx` thin; Home behavior lives in `src/features/home`, the bounded public-profile destination lives in `src/features/public-profile`, server authority lives in `src/server`, and the initial Room feature renders only missing, pre-admission, creator/admitted-boundary, and Past Stream projections. TanStack Query owns Home data; Better Auth owns session state; Socket.IO patches or invalidates canonical queries.

**Tech Stack:** Node 24.18.0, pnpm 11.11.0, TypeScript 5.9.3, React 19.2.7, TanStack Start 1.168.27 with Rsbuild 2.1.5, TanStack Query 5.101.2, React Pacer 0.22.1, Better Auth 1.6.23, Drizzle 0.45.2/PostgreSQL, Socket.IO 4.8.2, Valkey/ioredis 5.11.1, Tailwind CSS 4.3.2, Vitest 4.1.10, Playwright 1.61.1, fast-check 4.9.0.

**Design:** [`2026-07-12-home-room-route-design.md`](./2026-07-12-home-room-route-design.md)

---

## Scope guard

This plan does not build the admitted media workspace, Chat/People/Activity companions, WebRTC, Host moderation UI, private profile preferences, an Admin route, a component library, or speculative API layers. The thin Room boundary is real, persisted, authorized, and testable; its admitted projection contains only enough canonical state and navigation to complete Home creation/admission. The thin public-profile boundary is a real anonymous projection containing the matched Account's allowed identity, aggregate statistics, Past Stream history, and top co-users; it has no private settings or editing. Later route plans deepen both destinations without replacing their URLs or authority models.

## Task 1: Prove the pinned application and single-listener scaffold

**Files:**

- Create: `package.json`
- Create: `.npmrc`
- Create: `tsconfig.json`
- Create: `rsbuild.config.ts`
- Create: `postcss.config.mjs`
- Create: `src/router.tsx`
- Create: `src/routes/__root.tsx`
- Create: `src/routes/index.tsx`
- Create: `src/server.ts`
- Create: `server/index.mjs`
- Create: `server/dev.ts`
- Create: `tests/smoke/single-listener.test.ts`
- Create: `vitest.config.ts`
- Modify: `.gitignore`

**Step 1: Pin the exact toolchain and dependencies**

Create `package.json` with `packageManager: "pnpm@11.11.0"`, `engines.node: "24.18.0"`, ESM, and scripts:

```json
{
  "scripts": {
    "dev": "tsx watch server/dev.ts",
    "build": "rsbuild build",
    "start": "node server/index.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:e2e": "playwright test"
  }
}
```

Pin the ADR 0105 runtime versions exactly. Add direct imports as direct dependencies rather than relying on pnpm hoisting, including `@tanstack/react-router@1.170.17` selected by the pinned Start release and `@rsbuild/plugin-react@2.1.0`. Pin new planning decisions exactly: `tailwindcss@4.3.2`, `@tailwindcss/postcss@4.3.2`, `vitest@4.1.10`, `@playwright/test@1.61.1`, `fast-check@4.9.0`, and development-only `tsx@4.23.0`. Commit the generated `pnpm-lock.yaml`. Do not add Tailwind plugins, a UI kit, Express, an API framework, a state store, an icon package, or an animation package.

**Step 2: Write the failing listener smoke test**

The test starts the production host on an ephemeral port and asserts:

- `GET /` returns an HTML document;
- a built client asset is served from the same listener;
- a Socket.IO polling handshake succeeds at `/socket.io/`;
- an unknown route receives the Start not-found response rather than a second server's response.

Run:

```bash
pnpm test tests/smoke/single-listener.test.ts
```

Expected: FAIL because the host does not exist.

**Step 3: Implement the smallest scaffold**

Use `@tanstack/react-start/plugin/rsbuild` with `@rsbuild/plugin-react`. `src/server.ts` exports the Start fetch-style server entry and a named Socket.IO attachment function built to `dist/server/index.js`. `server/index.mjs` stays plain production JavaScript: it dynamically imports that build, owns one Node `http.Server`, safely serves files only from `dist/client`, forwards remaining requests to the fetch handler, and attaches Socket.IO through the named export. `server/dev.ts` runs through exact-pinned `tsx@4.23.0`, uses Rsbuild's supported `createDevServer()` middleware mode on one Node `http.Server`, imports the same Socket.IO application composition from source, and calls `connectWebSocket({ server })` for HMR. Keep request/response conversion and static-path containment in the hosts; do not add Express or another server framework.

The root route renders `HeadContent`, `Outlet`, and `Scripts`, with global error/not-found boundaries and no product chrome yet.

**Step 4: Verify scaffold behavior**

Run:

```bash
pnpm typecheck
pnpm build
pnpm test tests/smoke/single-listener.test.ts
```

Expected: all exit 0; one HTTP listener satisfies Start and Socket.IO.

**Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .npmrc tsconfig.json rsbuild.config.ts postcss.config.mjs src server tests/smoke vitest.config.ts .gitignore
git commit -m "build: scaffold single-listener TanStack Start app"
```

## Task 2: Establish test isolation and production-shaped fixtures

**Files:**

- Modify: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `tests/setup/unit.ts`
- Create: `tests/setup/integration.ts`
- Create: `tests/helpers/test-environment.ts`
- Create: `tests/helpers/test-server.ts`
- Create: `tests/helpers/test-clock.ts`
- Create: `tests/integration/environment.test.ts`

**Step 1: Write the failing isolation test**

Start two integration workers with distinct IDs. Assert each receives:

- its own PostgreSQL schema or database;
- a unique Valkey prefix;
- an ephemeral listener port;
- a deterministic application clock;

Expected: data created in worker A is absent in worker B; no authenticated fixture is required before auth exists.

Run:

```bash
pnpm test:integration tests/integration/environment.test.ts
```

Expected: FAIL because fixtures do not exist.

**Step 2: Implement two Vitest projects**

Configure `unit` and `integration` projects. Unit tests are process-local. Integration setup provisions worker-isolated PostgreSQL and Valkey state, applies migrations, starts the real Node host, and supplies URLs/IDs through Vitest project context. Do not use transaction rollback as server-test isolation.

Implement one `Clock`/`Scheduler` contract with production and test bindings. Keep it concrete: `now()`, `scheduleAt()`, and cancellation are enough for the documented timers.


**Step 3: Verify isolation**

Run the isolation test with at least two workers twice. Expected: deterministic pass and no leaked database, Valkey, port, or authentication state.

**Step 4: Commit**

```bash
git add vitest.config.ts playwright.config.ts tests
git commit -m "test: add isolated production-shaped fixtures"
```

## Task 3: Implement the visual tokens, theme, and root document

**Files:**

- Create: `src/styles/app.css`
- Create: `src/features/theme/theme.ts`
- Create: `src/features/theme/ThemeToggle.tsx`
- Create: `public/fonts/source-sans-3-latin.woff2`
- Modify: `src/routes/__root.tsx`
- Create: `tests/unit/theme.test.ts`
- Create: `tests/e2e/root-theme.spec.ts`

**Step 1: Write failing theme tests**

Assert:

- absent override follows `prefers-color-scheme`;
- anonymous local `light` or `dark` override wins and survives reload;
- invalid persisted values are ignored;
- the initial inline bootstrap sets `data-theme` before the application paints;
- reduced-motion media query removes transforms and Live pulse;
- root metadata contains the default title, description, viewport, and theme colors.

**Step 2: Define one CSS token source**

Use Tailwind v4 `@import "tailwindcss"`, `@theme`, and a `dark` custom variant based on `[data-theme=dark]`. Encode ADR 0096 exactly: Source Sans 3, fixed type scale, porcelain/midnight colors, semantic Live/Host/warning/danger/private roles, spacing, radii, breakpoints, z-index roles, and motion curve/durations.

Do not translate committed hex colors into approximate new colors. Do not create a parallel TypeScript token object. Tailwind utilities consume the CSS tokens.

**Step 3: Implement the root document**

Self-host the font, set `color-scheme`, install the pre-paint theme bootstrap, and expose one visible toggle backed by the anonymous local override. The Profile prerequisite later makes a signed-in PostgreSQL preference authoritative across devices through the same toggle. Use no page-load reveal animation, glass surfaces, decorative gradients, oversized radii, or invented control styling.

**Step 4: Verify**

Run unit and Playwright tests at light, dark, and reduced-motion settings. Check body and placeholder contrast against their actual surfaces.

**Step 5: Commit**

```bash
git add src/styles src/features/theme src/routes/__root.tsx public/fonts tests/unit/theme.test.ts tests/e2e/root-theme.spec.ts
git commit -m "feat: add BhayanakCast visual tokens and theme"
```

## Task 4: Add authentication, session projection, and Discord test boundary

**Files:**

- Create: `src/server/db/client.ts`
- Create: `src/server/db/schema/auth.ts`
- Create: `src/server/db/migrations/`
- Create: `src/server/auth/auth.ts`
- Create: `src/server/auth/session.ts`
- Create: `src/server/auth/discord-profile.ts`
- Create: `tests/helpers/test-account.ts`
- Create: `tests/e2e/fixtures.ts`
- Create: `src/features/auth/auth-client.ts`
- Create: `src/features/auth/SignInButton.tsx`
- Create: `src/features/auth/AccountMenu.tsx`
- Create: `tests/unit/discord-profile.test.ts`
- Create: `tests/integration/auth-session.test.ts`

**Step 1: Write failing auth contract tests**

Cover:

- Discord profile refresh on every sign-in;
- no-email identity maps to `<discord-id>@discord.placeholder.local` and never enters public projections;
- seven-day session and one-day update age;
- sign-out/revocation removes access immediately;
- arbitrary forwarded headers cannot spoof the trusted Cloudflare client IP;
- deterministic Discord test boundary creates real Better Auth sessions in isolated workers and independent Playwright browser contexts.

**Step 2: Generate and own the Better Auth schema**

Generate Better Auth tables once, then manage them through Drizzle migrations. Configure transactional Drizzle adapter use, encrypted OAuth tokens, disabled cookie cache, exact public origin/trusted origin, and no Better Auth secondary storage.

**Step 3: Expose only the minimal session projection**

The client receives opaque Account ID, mirrored display name/avatar, and authorization flags needed by these routes. It never receives the placeholder email or OAuth tokens.

**Step 4: Verify and commit**

Run focused unit/integration tests, then run one Playwright fixture smoke with two authenticated contexts. Commit auth schema, configuration, account fixtures, and UI entry points together.

## Task 5: Model the minimum Home and Room persistence

**Files:**

- Create: `src/server/db/schema/accounts.ts`
- Create: `src/server/db/schema/rooms.ts`
- Create: `src/server/db/schema/memberships.ts`
- Create: `src/server/db/schema/streams.ts`
- Create: `src/server/db/schema/subscriptions.ts`
- Create: `src/server/streams/subscription-service.ts`
- Create: `src/server/db/migrations/`
- Create: `src/server/rooms/room-policy.ts`
- Create: `src/server/rooms/room-repository.ts`
- Create: `src/server/rooms/room-service.ts`
- Create: `src/server/rate-limits/fixed-window.ts`
- Create: `src/server/rate-limits/room-limits.ts`
- Create: `tests/unit/room-policy.test.ts`
- Create: `tests/integration/room-persistence.test.ts`
- Create: `tests/integration/subscription-switch-cleanup.test.ts`
- Create: `tests/integration/room-rate-limits.test.ts`

**Step 1: Write failing domain tests**

Cover room name/category/tag/private-password validation, duplicate names, 10-member capacity, target-first membership switching, creator-as-Host entry, public/private admission, Full behavior, 12-hour lifetime, five-minute empty grace, opaque IDs, anonymous denial, room-creation sanctions, all-access sanctions, deletion-pending read-only behavior, room bans, immediate session/connection revocation, and atomic cleanup of the source room's active Stream and remote subscription on a confirmed successful switch.

Use fast-check only for normalization/length/bounded-tag properties. Keep named policy examples readable.

**Step 2: Add the minimum schema**

Use one room record for live and Past Stream lifecycle with immutable `createdAt`, nullable `endedAt`, visibility, password hash, normalized category, and normalized bounded tag array. Persist membership intervals and current Host authority. Keep current Stream metadata and preview key/timestamp on the Stream record. Add the minimum one-active-remote-subscription record now so target-first switching and confirmation can preserve/close real canonical state; signaling behavior waits for the Room plan.

Enforce uniqueness and cardinality where PostgreSQL can do it. Do not create separate read-model tables, event sourcing, generic entity tables, or a background job framework.

**Step 3: Implement one transactional room service**

The service owns create, inspect pre-admission, admit, confirmation-required source consequences, leave/switch, revive, and end transitions. Validate a target before changing the current membership; on confirmed success, transactionally end the source Stream/subscription and apply Host/lifecycle effects. Return explicit domain outcomes rather than UI strings.

**Step 4: Enforce the Home/admission abuse limits**

Use Valkey atomic increment/expiry windows for room creation (5/hour/Account) and private-password attempts (10/10 minutes/Account + room + trusted client IP). Limit rejection is an explicit recoverable domain outcome. Valkey unavailability fails these mutations closed without turning it into session storage. Keep the helper limited to fixed windows; do not build a generic policy engine.

**Step 5: Verify and commit**

Run focused unit and real-PostgreSQL/Valkey integration tests, including transaction rollback on failed target admission, exact boundary/reset behavior for both limits, and fail-closed mutation behavior when Valkey is unavailable.

## Task 6: Implement canonical Home search values and query projections

**Files:**

- Create: `src/features/home/home-search.ts`
- Create: `src/features/home/home-types.ts`
- Create: `src/server/home/home-repository.ts`
- Create: `src/server/home/home-functions.ts`
- Create: `src/features/home/home-queries.ts`
- Create: `src/features/home/HomeSectionBoundary.tsx`
- Create: `src/features/home/HomeSectionSkeletons.tsx`
- Modify: `src/routes/index.tsx`
- Create: `tests/unit/home-search.test.ts`
- Create: `tests/unit/home-ranking.test.ts`
- Create: `tests/integration/home-projection.test.ts`
- Create: `tests/e2e/home-section-recovery.spec.ts`

**Step 1: Write failing URL/property tests**

Cover `src/routes/index.tsx` `validateSearch` parsing and canonicalization for normalized `q`, optional `category`, and sorted/deduplicated `tags`: empty removal, Unicode normalization, exact category matching, tags AND, queries under three characters receiving no fuzzy expansion, exact/prefix/substring before conservative fuzzy results, room tie ranking, profile tie ordering, and idempotent canonicalization.

**Step 2: Define bounded projection types**

Home returns only fields the UI may expose:

- Active Room summary with privacy-safe presence, counts, state, category/tags, and up to four freshest Preview records;
- Past Stream summary limited to ten;
- Public Profile search result with identity, aggregate statistics, three Past Streams, and three co-users;
- facets, statistics, and connected presence as independent responses.

Private rooms never project participant identities. Public card avatar stacks never project names.

**Step 3: Implement server functions and Query options**

Validate server-function inputs with production parsers. Query functions forward `AbortSignal`. Use 15-second stale time for rooms/presence, 30 seconds for facets/statistics, 60 seconds for profiles/Past Streams, and 10-minute inactive garbage collection. The loader calls `ensureQueryData` only for the visible rooms/search projection and Past Streams; it prefetches noncritical sections without blocking the route.

**Step 4: Verify SSR/cache behavior**

Integration tests prove one QueryClient per request, no cross-session cache leak, hydration without duplicate initial fetch, abort on superseded keys, and Query v5 `placeholderData: keepPreviousData` plus `isPlaceholderData` behavior.

**Step 5: Implement independent section recovery**

Facets, statistics, and connected presence each render a shape-matched skeleton on first load, preserve their last canonical value during background refresh, and show observer-local failure copy with a Retry that refetches only the exact failed key. A missing/failed metric is unavailable, never zero. Discovery/search and Past Streams remain readable and interactive when any noncritical section fails. Local Retry does not reset search focus, scroll, or the stable featured-room snapshot.

Production-shaped tests fail each query independently and Playwright asserts the unaffected sections, exact-key Retry, accessible status announcement, and focus preservation.

**Step 6: Commit**

Commit the canonical URL model, bounded projections, server functions, and route loader together.

## Task 7: Build the responsive Home shell and primary navigation

**Files:**

- Create: `src/features/home/HomePage.tsx`
- Create: `src/features/home/HomeNavigation.tsx`
- Create: `src/features/home/HomeUtilities.tsx`
- Create: `src/features/home/HomeSections.tsx`
- Create: `tests/e2e/home-shell.spec.ts`

**Step 1: Write failing responsive/accessibility tests**

At small, medium, and wide viewports assert the exact rail/top/bottom composition, one document scroll, safe-area padding, visible labels/tooltips, persistent Create access, session-dependent account control, semantic landmarks, keyboard order, and no duplicate interactive copy hidden off-screen.

**Step 2: Implement one semantic tree**

Render search utilities, Live Rooms, and Past Streams once. Use Tailwind structural variants to place wide/medium rails and small bars. Do not build three independent pages. Wide rails use sticky viewport-height behavior only while they fit; no nested document scroll.

Use familiar buttons, links, menus, and labels. Cobalt indicates action/selection only. Keep Source Sans 3 fixed sizes; no fluid display type.

**Step 3: Verify and commit**

Run Playwright at 390px, 1024px, and 1440px in both themes. Commit after keyboard and responsive checks pass.

## Task 8: Implement Live Rooms, Past Streams, and empty discovery

**Files:**

- Create: `src/features/home/LiveRooms.tsx`
- Create: `src/features/home/LiveRoomCard.tsx`
- Create: `src/features/home/PreviewMosaic.tsx`
- Create: `src/features/home/PastStreams.tsx`
- Create: `src/features/home/EmptyDiscovery.tsx`
- Create: `tests/unit/home-snapshot.test.ts`
- Create: `tests/e2e/home-discovery.spec.ts`

**Step 1: Write failing snapshot and layout tests**

Prove member count descending, Stream count descending, activity tie-break, rank-1 feature stability, no promotion when a room ends, recomputation only on documented triggers, up to four freshest previews, private blur, no identity leak, and no placeholders for missing room slots.

**Step 2: Implement the editorial grid**

Wide: feature on the left spanning ranks 2–3; medium: full-width feature then two columns; small: one rank-ordered column. Preserve DOM rank order even when CSS placement changes. A card is one accessible link to `/rooms/$roomId`; chips are descriptive, never nested controls.

Rooms without Streams show actual presence/state metadata. Past Streams use a compact two-column desktop list and one mobile column with no image, replay, carousel, pagination, or fake thumbnail.

**Step 3: Implement the empty invitation**

Render “The clubhouse is quiet,” concise public/private context, and Create Room. Retain Past Streams below or one first-community cue. No illustration or onboarding sequence.

**Step 4: Verify and commit**

Run unit snapshot tests, Playwright navigation/link tests, privacy assertions, and visual baselines for normal/empty states.

## Task 9: Implement URL-backed search, filters, and result projections

**Files:**

- Create: `src/features/home/HomeSearch.tsx`
- Create: `src/features/home/HomeFilters.tsx`
- Create: `src/features/home/HomeSearchResults.tsx`
- Create: `src/features/home/RoomSearchResult.tsx`
- Create: `src/features/home/ProfileSearchResult.tsx`
- Modify: `src/routes/index.tsx`
- Create: `src/routes/users/$userId.tsx`
- Create: `src/features/public-profile/PublicProfilePage.tsx`
- Create: `src/features/public-profile/public-profile-queries.ts`
- Create: `tests/e2e/public-profile-boundary.spec.ts`
- Create: `tests/e2e/home-search.spec.ts`

**Step 1: Write failing browser tests**

Cover 250ms trailing navigation, Enter flush, replace-history behavior, back/forward/reload/share restoration, immediate filters, active chips/Clear all, sticky-only-while-active behavior, preserved prior results with localized progress, polite count announcements, focus stability, and request cancellation.

**Step 2: Implement one search controller**

Use Pacer `useDebouncer`; do not write a local debounce hook. Wide/medium use native accessible combobox behavior for Category and Tags. Small uses one Filters button and a native dialog-based bottom sheet. Use portals or native top-layer behavior so menus/sheets are not clipped.

Query replaces the normal center sections with Active Room and Public Profile groups. Filters continue to affect rooms only. Result cards are single links; excerpt content is non-interactive and never triggers per-card requests.

**Step 3: Implement the bounded public-profile destination**

Add `/users/$userId` as an anonymously readable, indexable route. Validate the opaque ID, return a generic not-found response when absent/hidden/deleted, and project only Discord-mirrored display name/avatar, aggregate usage statistics, Past Stream history, and top co-users. Reuse the bounded Home projection/query code where it already fits; do not create private `/profile` behavior, editing, live private-room identities, or a second profile cache boundary. Every Home profile result navigates to this real destination.

Playwright must prove keyboard navigation from the result, direct/reload access, index metadata, generic not-found behavior, and absence of hidden/deletion-pending Accounts.

**Step 4: Verify and commit**

Run URL unit tests, Query integration tests, and Playwright keyboard/history/cancellation tests.

**Execution checkpoint:** Execute [`2026-07-12-profile-route-prerequisite.md`](./2026-07-12-profile-route-prerequisite.md) now, then resume Task 10. This prevents Home's signed-in Profile navigation from being declared complete against a missing destination.

## Task 10: Add Home realtime synchronization and recovery

**Files:**

- Create: `src/server/realtime/socket-server.ts`
- Create: `src/server/realtime/home-events.ts`
- Create: `src/features/home/home-realtime.ts`
- Create: `src/features/home/HomeConnectionStatus.tsx`
- Create: `tests/integration/home-realtime.test.ts`
- Create: `tests/e2e/home-reconnect.spec.ts`

**Step 1: Write failing realtime tests**

Use two Accounts and direct Socket.IO clients. Prove value-only count/status/preview patches do not reorder the frozen snapshot; membership-changing events invalidate only affected keys; room end closes its cell without promotion; reconnect marks live data stale, invalidates active keys, refetches canonical state, and recomputes rank once.

Also prove one active connection per Account and no unauthorized private identities in events.

**Step 2: Implement the minimum event set**

Emit domain events with opaque IDs and bounded payloads. Home translates them into Query cache patches or targeted invalidation. Do not add a parallel client store or duplicate Query state in React context.

**Step 3: Verify and commit**

Run production-shaped integration and browser reconnect tests without arbitrary sleeps.

## Task 11: Implement Create Room and the thin real Room boundary

**Files:**

- Create: `src/features/home/CreateRoomDialog.tsx`
- Create: `src/features/home/create-room.ts`
- Create: `src/features/room/room-types.ts`
- Create: `src/features/room/room-queries.ts`
- Create: `src/features/room/RoomRoute.tsx`
- Create: `src/features/room/RoomNotFound.tsx`
- Create: `src/features/room/RoomPreAdmission.tsx`
- Create: `src/features/room/RoomAdmittedBoundary.tsx`
- Create: `src/features/room/MembershipConsequencesDialog.tsx`
- Create: `src/features/room/PastStreamSummary.tsx`
- Modify: `src/routes/rooms/$roomId.tsx`
- Create: `tests/integration/create-admit.test.ts`
- Create: `tests/e2e/create-and-open-room.spec.ts`
- Create: `tests/e2e/room-oauth-return.spec.ts`

**Step 1: Write failing creation/admission tests**

Cover:

- trimmed 3–80-character name;
- optional normalized 32-character category;
- up to five normalized 24-character tags;
- Public default;
- Private password minimum eight characters and no retrieval;
- anonymous Create OAuth return reopening a blank form only;
- failed create preserving current membership;
- successful create entering creator as Host;
- room-card navigation never auto-joining;
- private password omitted from OAuth intent;
- anonymous Join OAuth carries only `roomId`, returns to the same pre-admission projection without membership, discards any private password, and re-evaluates current visibility/capacity/ban/sanction/end gates;
- public, private, changed-to-Full, and ended targets remain canonical across OAuth return;
- Full disables Join;
- missing room returns generic 404;
- ended room renders Past Stream with no Join.
- create, switch, or Leave by a current Host and/or active streamer returns an authoritative confirmation-required outcome naming Stream-stop and Host-transfer effects;
- Cancel preserves the current membership, Stream, subscription, and Host authority; Confirm revalidates current state before committing.

**Step 2: Implement one responsive Create form**

Use one component and state model. Present it as centered modal at wide/medium and full-screen at small. Implement focus trap/return, Escape/dismiss rules, explicit Cancel/Create, safe-area and software-keyboard behavior, inline validation, pending state, and canonical server errors. Do not persist drafts.

**Step 3: Implement the Room projection selector**

The route loader validates opaque `roomId`, fetches the allowed projection, sets `noindex`, and renders missing, pre-admission, admitted-boundary, or Past Stream. Explicit Join is a real authorized server mutation. `RoomAdmittedBoundary` is a legitimate minimal admitted surface: canonical room name/privacy/lifetime, the viewer's Member/Host state, current member/Stream counts, Back/Home, and a working Leave action. It exposes no fake media, chat, companions, or disabled future controls. The linked Room plan deepens this component in place rather than replacing the route or authority model.

**Step 4: Implement membership-consequence confirmation**

Create, Join/switch, and Leave call the same server policy before mutation. When the current membership is Host-owned or actively streaming, return a structured `confirmationRequired` result with the current consequences and a short-lived opaque confirmation token/version. The dialog names the affected Stream stop and/or Host handoff. Cancel performs no mutation. Confirm submits the token, revalidates both source and target gates transactionally, and either commits the transition or returns updated consequences/errors; it never trusts stale client state.

Anonymous Join stores only `roomId` through OAuth. Return always renders pre-admission and requires another explicit Join; private passwords are never stored, and every gate is read again from canonical state.

**Step 5: Verify the Home completion journey**

Playwright uses multiple contexts to prove:

1. anonymous Home discovery;
2. OAuth return to Home Create intent;
3. authenticated room creation and creator Host entry;
4. another Account opening the card without membership;
5. explicit public/private admission;
6. failed target admission preserving an existing membership.
7. anonymous public/private Join OAuth return without auto-admission or password retention;
8. targets becoming Full or ended during OAuth;
9. create/switch/Leave confirmation Cancel preserving all source state and Confirm applying revalidated consequences.

**Step 6: Commit**

```bash
git add src/features/home src/features/room src/routes/rooms tests/integration/create-admit.test.ts tests/e2e/create-and-open-room.spec.ts
git commit -m "feat: complete Home and room admission boundary"
```

## Task 12: Smoke-test the completed Home route, then perform final plan cleanup

**Files:**

- Modify only files exposed by the smoke test
- Add no new abstraction unless two existing consumers require it

**Step 1: Run focused verification**

```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e -- --project=chromium tests/e2e/root-theme.spec.ts tests/e2e/home-shell.spec.ts tests/e2e/home-discovery.spec.ts tests/e2e/home-search.spec.ts tests/e2e/home-reconnect.spec.ts tests/e2e/create-and-open-room.spec.ts
pnpm build
```

Expected: all exit 0. Confirm no test passes only on retry.

**Step 2: Run user-visible smoke scenarios**

Use the browser at 390px, 1024px, and 1440px in both themes. Verify normal, empty, search, section-failure, reconnecting, anonymous Create, authenticated Create, private/full pre-admission, admitted-boundary, and Past Stream projections. Capture selective visual baselines only for stable states.

**Step 3: Check route contracts**

Confirm:

- `/` is indexable and server-rendered;
- `/rooms/:roomId` is `noindex`;
- no nested Create/settings/search routes were added;
- no private identity/password leaks through HTML, Query cache, Socket.IO, analytics, or logs;
- no placeholder Room implementation claims media/chat functionality;
- no component library, client state store, Express layer, job framework, or unused future abstraction entered the dependency graph.

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify Home route contract"
```

## Home plan completion criteria

The plan is complete only when anonymous and authenticated users can load a server-rendered Home, use canonical search and filters, navigate every Public Profile result to a real bounded public profile, reach the completed authenticated `/profile` prerequisite from every signed-in Home navigation, inspect resilient Live Room/Past Stream sections, survive realtime reconnect, initiate responsive Create Room, complete Discord return safely, create a room, navigate to existing rooms, and explicitly enter an allowed room through the real thin Room boundary. Only the full admitted Room workspace remains delegated to the linked Room plan.
