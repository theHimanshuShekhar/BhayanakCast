# Profile Route Prerequisite Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Deliver the authenticated `/profile` route required by Home navigation, including the Account's public activity projection, private theme/mute preferences, and self-service deletion request/cancellation without creating a separate settings route.

**Architecture:** Reuse the public-profile projection already required by Home search, then compose private authenticated sections on `/profile`. Better Auth remains the session/credential authority; PostgreSQL owns account preferences, mutes, and deletion-request state. Submission immediately changes the Account to hidden/read-only through shared server authorization policy. Platform Admin approval/rejection UI remains in the later `/admin` plan, but this plan establishes the canonical request state and user-visible pending/cancel behavior.

**Tech Stack:** The Home plan's scaffold, auth, Drizzle/PostgreSQL, TanStack Start/Query, Tailwind tokens, Vitest, and Playwright. Add no form library, settings framework, local profile editor, or client state store.

**Execution point:** Complete Tasks 1–9 of [`2026-07-12-home-route-implementation.md`](./2026-07-12-home-route-implementation.md), execute this plan, then resume Home Task 10. Home is not complete until `/profile` passes this plan.

**Design:** [`2026-07-12-home-room-route-design.md`](./2026-07-12-home-room-route-design.md)

---

## Scope guard

This route does not permit local display-name/avatar editing; Discord identity refreshes on sign-in. It does not expose private preferences publicly, add a `/settings` route, add policy acceptance to ordinary participation, implement Platform Admin review UI, or immediately delete an Account on submission. Approved deletion processing and retention qualification remain shared server/operations work completed with the later Admin plan.

## Task 1: Add the authenticated Profile projection and route

**Files:**

- Create: `src/routes/profile.tsx`
- Create: `src/features/profile/profile-types.ts`
- Create: `src/features/profile/profile-queries.ts`
- Create: `src/features/profile/ProfilePage.tsx`
- Create: `src/features/profile/ProfileOverview.tsx`
- Modify: `src/features/public-profile/public-profile-queries.ts`
- Create: `tests/integration/profile-projection.test.ts`
- Create: `tests/e2e/profile-route.spec.ts`

**Step 1: Write failing route tests**

Cover:

- anonymous direct navigation returns through Discord sign-in and then `/profile` without creating another intent;
- authenticated navigation renders the current Account only;
- mirrored Discord name/avatar are read-only;
- public activity/statistics/Past Streams/co-users reuse the allowed public projection;
- private preference and deletion sections never enter `/users/:userId`, Home search, SSR for another Account, or Socket.IO payloads;
- deletion-pending Account still reads its own request status while its public projection is hidden;
- invalid/revoked session returns to authentication immediately.

**Step 2: Reuse, do not duplicate, the public projection**

Extract only the server query/projection already shared by Home results, `/users/:userId`, and the current Account overview. `/profile` may request additional private fields through a separate authenticated function. Do not put private fields into a broad profile type and rely on UI omission.

**Step 3: Implement the route**

Use one page heading and clear Public activity, Preferences, and Account deletion sections. The route is authenticated and `noindex`; `/users/:userId` remains anonymous/indexable. Use the Home navigation vocabulary and shared tokens, not a dashboard shell or card grid.

**Step 4: Verify and commit**

Run focused integration and Playwright tests, including direct/reload/back behavior and private projection checks.

## Task 2: Persist and synchronize the theme preference

**Files:**

- Create: `src/server/db/schema/preferences.ts`
- Create: `src/server/profile/preference-service.ts`
- Create: `src/features/profile/ThemePreference.tsx`
- Modify: `src/features/theme/theme.ts`
- Modify: `src/features/theme/ThemeToggle.tsx`
- Modify: `src/routes/__root.tsx`
- Create: `tests/unit/theme-preference.test.ts`
- Create: `tests/integration/theme-preference.test.ts`
- Create: `tests/e2e/profile-theme.spec.ts`

**Step 1: Write failing preference precedence tests**

Prove:

- anonymous initial theme follows device preference plus an optional local override;
- signed-in Account's PostgreSQL preference is authoritative across devices;
- changing the signed-in theme updates the document immediately, persists canonically, and survives reload/new context;
- signing out returns to device/local anonymous behavior without leaking the prior Account's private preference;
- only `light`, `dark`, or no override are accepted;
- pre-paint bootstrap avoids a light/dark flash.

**Step 2: Add one preference row per Account**

Persist only the settings V1 actually has. Use nullable theme override rather than a generic JSON settings bag. The Profile control and visible global toggle call the same authenticated mutation; do not maintain two preference systems.

**Step 3: Verify and commit**

Run unit precedence, real-session integration, and two-browser-context persistence tests in both themes and reduced-motion mode.

## Task 3: Implement persistent chat mute management

**Files:**

- Create: `src/server/db/schema/chat-mutes.ts`
- Create: `src/server/profile/chat-mute-service.ts`
- Create: `src/features/profile/MutedAccounts.tsx`
- Create: `tests/integration/chat-mutes.test.ts`
- Create: `tests/e2e/profile-mutes.spec.ts`

**Step 1: Write failing mute tests**

Cover:

- an Account can mute another Account once and idempotently;
- self-mute is rejected;
- muted Account is not notified and no room Activity event is emitted;
- mute affects only chat presentation for the muting Account;
- membership, Streams, discovery, public profiles, reports, and the target's experience remain unchanged;
- Profile lists only the viewer's muted Accounts with current mirrored identity and an accessible Unmute action;
- unmute immediately restores future and currently loaded allowed chat presentation;
- deleted/anonymized targets do not leak identity.

**Step 2: Implement the smallest relation and service**

Use a composite unique key `(mutingAccountId, mutedAccountId)` and timestamps. Return the viewer's bounded mute list through an authenticated server function. Do not add mute categories, durations, notes, bulk actions, or a generic block system.

**Step 3: Integrate the Room consumer contract**

Expose one server-side/chat-projection predicate and one current-viewer mute-ID set that the later Room plan can consume. Do not implement Chat UI in this plan.

**Step 4: Verify and commit**

Use two Accounts to prove privacy, idempotence, and the absence of room/realtime side effects.

## Task 4: Implement deletion request, pending state, and cancellation

**Files:**

- Create: `src/server/db/schema/deletion-requests.ts`
- Create: `src/server/profile/deletion-service.ts`
- Create: `src/server/auth/account-access-policy.ts`
- Create: `src/features/profile/AccountDeletion.tsx`
- Create: `src/features/profile/DeletionConfirmation.tsx`
- Modify: `src/server/auth/session.ts`
- Modify: `src/server/rooms/room-policy.ts`
- Modify: `src/server/home/home-repository.ts`
- Create: `tests/unit/account-access-policy.test.ts`
- Create: `tests/integration/account-deletion-request.test.ts`
- Create: `tests/e2e/profile-deletion.spec.ts`

**Step 1: Write failing state-transition tests**

Model `active → pending → cancelled` and the externally administered `pending → rejected | approved` transitions. This plan implements the current Account's submit/cancel paths and policy response to all canonical states. Cover:

- explicit irreversible confirmation names immediate hiding/read-only consequences and displays the applicable terms;
- ordinary participation has no terms gate;
- submission immediately hides public profile, statistics, history, co-user presence, and Home profile-search membership;
- pending Account is restricted to read-only discovery and public-profile browsing;
- pending Account cannot create/join, chat, stream, report, moderate, or open a new live membership;
- submission ends existing live membership/Stream/subscription through normal lifecycle and Host-handoff effects;
- pending Account can view `/profile` status and cancel;
- cancellation or Admin rejection restores public projection and ordinary access immediately;
- approval revokes credentials and can no longer be cancelled;
- duplicate submit/cancel commands are idempotent and audited without exposing terms or identity content to telemetry.

**Step 2: Centralize account access policy**

Every authenticated mutation asks one policy function for active/pending/sanctioned/deleted access. UI hiding is not authorization. Keep the policy result explicit and small; do not build a rules engine.

**Step 3: Implement confirmation and pending UX**

Use a focused native dialog with explicit Cancel and destructive confirmation. Do not use a generic “Are you sure?” string. Pending state replaces editable preference actions with request status, explanation, and Cancel request. It does not promise an SLA or show internal moderation detail.

**Step 4: Verify and commit**

Use real Better Auth sessions, PostgreSQL, Socket.IO, and two browser contexts to prove immediate hiding, forced live departure, read-only enforcement, cancellation restoration, and session revocation behavior.

## Task 5: Complete responsive, accessibility, and Home-navigation integration

**Files:**

- Modify: `src/features/profile/ProfilePage.tsx`
- Modify: `src/features/home/HomeNavigation.tsx`
- Modify: `src/features/auth/AccountMenu.tsx`
- Create: `tests/e2e/profile-responsive.spec.ts`
- Modify: `tests/e2e/home-shell.spec.ts`

**Step 1: Write failing navigation and accessibility tests**

At 390px, 1024px, and 1440px cover signed-in Home Profile navigation, direct `/profile` access, Back/Home, section headings, visible private/public labels, keyboard-only preference and deletion controls, focus return, safe areas, long Discord names, empty mute/history states, both themes, reduced motion, and actual text/placeholder contrast.

**Step 2: Implement one responsive document flow**

Use the existing Home non-room navigation at small sizes and familiar account navigation at medium/wide. Keep private sections visually explicit without nested card stacks. Use standard lists for muted Accounts and ordinary form controls for preferences. No new sidebar, settings route, tabs, or modal-first page composition.

**Step 3: Verify and commit**

Run Playwright with anonymous, active, pending, and cancelled Accounts. Add selective visual baselines for active and pending Profile states only.

## Task 6: Smoke-test the Profile prerequisite, then perform final plan cleanup

**Files:**

- Modify only files exposed by the smoke test
- Add no abstraction unless current code has two concrete consumers

**Step 1: Run focused verification**

```bash
pnpm typecheck
pnpm test:unit -- tests/unit/theme-preference.test.ts tests/unit/account-access-policy.test.ts
pnpm test:integration -- tests/integration/profile-projection.test.ts tests/integration/theme-preference.test.ts tests/integration/chat-mutes.test.ts tests/integration/account-deletion-request.test.ts
pnpm test:e2e -- --project=chromium tests/e2e/profile-route.spec.ts tests/e2e/profile-theme.spec.ts tests/e2e/profile-mutes.spec.ts tests/e2e/profile-deletion.spec.ts tests/e2e/profile-responsive.spec.ts
pnpm build
```

Expected: all exit 0; no test succeeds only on retry.

**Step 2: Check authority boundaries**

Confirm:

- `/profile` is authenticated and `noindex`;
- `/users/:userId` remains public/indexable but receives no preferences, mute list, deletion status, placeholder email, or credentials;
- no local identity editing exists;
- one persisted theme preference drives both Profile and global toggle;
- mute changes only the current viewer's chat;
- pending deletion immediately hides public data and enforces read-only browsing at the server;
- submission does not claim immediate deletion or a processing SLA;
- no `/settings` route or generic preferences framework was added.

**Step 3: Final commit**

```bash
git add -A
git commit -m "test: verify Profile prerequisite contract"
```

## Profile plan completion criteria

Home may be declared complete only when its signed-in Profile navigation reaches this real route; current Account public activity and private sections remain clearly separated; theme and mute preferences persist without public leakage; deletion submission immediately hides/restricts the Account through server policy; pending users can cancel; and no ordinary participation flow gains a terms-acceptance gate.
