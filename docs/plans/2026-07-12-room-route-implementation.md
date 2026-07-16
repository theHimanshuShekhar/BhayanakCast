# Room Route Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Deepen the existing `/rooms/:roomId` boundary into the complete admitted Room workspace, including membership recovery, companions, screen sharing, one explicit watch, moderation, responsive presentations, and in-place Past Stream transition.

**Architecture:** Preserve one stable `noindex` route and its missing, pre-admission, admitted, and Past Stream projections. Server services and authenticated Socket.IO own canonical room, membership, chat, moderation, Stream, subscription, lifecycle, and signaling state. The browser owns capture tracks, `RTCPeerConnection`, mute/fullscreen, local drafts/scroll state, and viewer-local display preferences. The same admitted state model composes wide dock, medium drawer, and small sheet presentations.

**Tech Stack:** The completed Home plan stack plus browser-native Media Capture and Streams APIs, browser-native `RTCPeerConnection`, public STUN, authenticated Socket.IO signaling, React Pacer AsyncRetryer/Throttler APIs, Vitest integration fixtures, and Playwright synthetic media. Add no PeerJS, PeerServer, TURN/SFU client, media framework, global client store, component library, or motion package.

**Prerequisites:** [`2026-07-12-home-route-implementation.md`](./2026-07-12-home-route-implementation.md) and [`2026-07-12-profile-route-prerequisite.md`](./2026-07-12-profile-route-prerequisite.md)

**Design:** [`2026-07-12-home-room-route-design.md`](./2026-07-12-home-room-route-design.md)

---

## Scope guard

This plan completes the Room route itself and only the supporting server endpoints required by that route, such as preview upload/read and authenticated realtime commands. It does not build `/profile`, `/users/:userId`, `/admin`, a public transcript page, a general notification system, replay media, voice, microphone controls, source replacement, multi-watch, TURN, SFU, Host-written moderation reasons, waitlists, or a generic workflow engine.

## Task 1: Make the Room projection selector authoritative under live transitions

**Files:**

- Modify: `src/features/room/room-types.ts`
- Modify: `src/features/room/room-queries.ts`
- Modify: `src/features/room/RoomRoute.tsx`
- Modify: `src/routes/rooms/$roomId.tsx`
- Modify: `src/server/rooms/room-service.ts`
- Create: `src/server/rooms/room-projection.ts`
- Create: `tests/unit/room-projection.test.ts`
- Create: `tests/integration/room-route-transitions.test.ts`

**Step 1: Write failing projection tests**

Table-drive:

- unknown opaque ID → generic missing response;
- live room without membership → public/private/full pre-admission projection;
- current admitted membership → admitted projection;
- kick, ban, displacement, all-access sanction, or admission loss → pre-admission projection at the same URL;
- 12-hour expiry or Platform Admin end → Past Stream projection at the same URL;
- ended room direct navigation → Past Stream projection;
- private pre-admission never exposes members or password metadata;
- every non-missing room response emits `robots: noindex`.

**Step 2: Define one discriminated projection**

Use a closed server-returned union:

```ts
type RoomRouteProjection =
  | { kind: 'preAdmission'; room: PreAdmissionRoom }
  | { kind: 'admitted'; room: AdmittedRoom; self: SelfMembership }
  | { kind: 'pastStream'; room: PastStreamSummary }
```

Missing uses TanStack Router `notFound()` rather than entering the union. Do not infer admission from client cache or render all projections and hide three with CSS.

**Step 3: Wire canonical invalidation**

Room lifecycle and forced-departure events invalidate the projection query. The component switches projection in place without changing `roomId`, resetting focus to the new primary heading and closing stale menus/dialogs/media.

**Step 4: Verify and commit**

Run focused unit and production-shaped integration tests, then commit the projection union and transition handling.

## Task 2: Complete membership, reconnect grace, Host succession, and lifetime scheduling

**Files:**

- Modify: `src/server/db/schema/memberships.ts`
- Modify: `src/server/db/schema/rooms.ts`
- Create: `src/server/rooms/membership-service.ts`
- Create: `src/server/rooms/room-lifecycle.ts`
- Create: `src/server/rooms/host-policy.ts`
- Modify: `src/server/realtime/socket-server.ts`
- Create: `src/server/realtime/connection-registry.ts`
- Create: `tests/unit/host-policy.test.ts`
- Create: `tests/integration/membership-lifecycle.test.ts`
- Create: `tests/integration/connection-displacement.test.ts`

**Step 1: Write failing lifecycle/model tests**

Use model-generated command sequences to prove:

- one live membership per Account;
- target-first switch preserves the old membership on target failure;
- successful switch ends prior Stream/subscription and runs prior-room effects;
- unexpected disconnect reserves capacity for 45 seconds;
- same Account reclaims without admission but no Stream/watch restoration;
- intentional leave, kick, ban, displacement, sanction, and room end receive no grace;
- earliest continuously present remaining member becomes Host;
- final departure starts five-minute empty grace;
- first eligible revival member becomes Host;
- immutable creation time drives 12-hour expiry despite reconnect/revival/update/Host transfer;
- warnings occur at 30, 10, and 1 minute once.

**Step 2: Use the existing application clock/scheduler**

Persist canonical deadlines. Schedule callbacks through the injected scheduler and re-check database state transactionally when they fire. Do not trust an old in-memory timer callback after revival, end, or process recovery. Do not add a queue for V1; the single-node scheduler plus persisted deadlines is sufficient.

**Step 3: Enforce one active connection**

The new authenticated Socket.IO connection atomically displaces older Account connections. A displaced client receives one terminal event, clears Room/media state, and disables automatic reconnect before disconnecting.

**Step 4: Verify and commit**

Advance the controlled clock rather than sleeping. Add a small real-timer smoke for scheduler wiring. Commit only after lifecycle invariants pass with multiple deterministic seeds.

## Task 3: Build the admitted room state model and responsive workspace shell

**Files:**

- Modify: `src/features/room/RoomAdmittedBoundary.tsx`
- Create: `src/features/room/RoomWorkspace.tsx`
- Create: `src/features/room/RoomHeader.tsx`
- Create: `src/features/room/RoomAppRail.tsx`
- Create: `src/features/room/RoomCanvas.tsx`
- Create: `src/features/room/RoomControlShelf.tsx`
- Create: `src/features/room/RoomCompanion.tsx`
- Create: `src/features/room/room-session.ts`
- Create: `tests/e2e/room-shell.spec.ts`

**Step 1: Write failing responsive/accessibility tests**

At 390px, 1024px, and 1440px assert:

- stable header metadata, privacy/Full/live state, Host, counts, category/tags, and lifetime countdown;
- wide 72px app rail, bounded media canvas, shelf, and persistent 360px dock;
- medium app rail and non-modal companion drawer with no scrim/focus trap/media pause/grid reflow;
- small compact header and contextual room bar replacing global bottom navigation;
- Back/Home and Leave remain reachable; the shelf reserves layout space but does not render Start/Stop until Task 6 provides the real controller;
- focus return for drawer/sheet/dialog controls;
- no duplicated interactive controls hidden off-screen.

**Step 2: Define one room-session reducer**

Keep only viewer-local presentation state: active companion tab, dock collapsed/open, mobile sheet height, chat draft, scroll anchors, unread markers, selected menu, and hide-non-streamers. Canonical room data remains in Query/realtime projections; media state remains in the media controller. Do not add Redux/Zustand or a generic event bus.

**Step 3: Implement structural layouts**

Use the shared Tailwind tokens and one semantic component tree. The media canvas remains midnight in both themes. CSS changes placement at 768/1280px. Do not use fluid display typography, nested cards, decorative gradients, glass panels, or page-load choreography.

**Step 4: Verify and commit**

Run keyboard, focus, safe-area, short-height, overflow, both-theme, and reduced-motion checks before committing the shell.

## Task 4: Implement canonical members and the stable mosaic

**Files:**

- Create: `src/features/room/member-order.ts`
- Create: `src/features/room/RoomMosaic.tsx`
- Create: `src/features/room/MemberTile.tsx`
- Create: `src/features/room/StreamPreview.tsx`
- Create: `src/features/room/WatcherStack.tsx`
- Create: `tests/unit/member-order.test.ts`
- Create: `tests/e2e/room-mosaic.spec.ts`

**Step 1: Write failing order/property tests**

Prove the order is You, initial current Host when different, then continuous join order. New members append. Host, Stream, compatibility, reconnect, and watch-state changes never reorder existing tiles. Viewer-local hiding removes only non-streamer tiles from that viewer's mosaic and never changes People or canonical presence.

**Step 2: Implement real tile semantics**

A non-streamer tile uses the Account's real avatar, name, and Host/You/reconnecting/compatibility labels; it never imitates camera-off video. A streaming tile uses a non-interactive visibility-aware Preview plus an informational footer containing identity, Live/freshness, and watcher stack/count. Task 6 replaces the viewer's own server Preview with the real browser-local muted capture; Task 8 adds the working Watch action; Task 9 adds the working contextual menu. This task renders no disabled, temporary, or no-op future controls.

Use contained 16:9 media/presence regions and persistent footers below them. Normal desktop/medium cells never shrink below 240px; scroll the bounded mosaic first.

**Step 3: Implement adaptive placement**

No watch: normal responsive mosaic. One watch: selected tile spans two columns/two rows on desktop/medium without changing logical order; remaining tiles fill row-major. Small uses primary watched stage plus horizontal remaining-member strip.

**Step 4: Verify and commit**

Test 1–10 members, zero/multiple Streams, Host changes, private/public visibility, long names, zoom, keyboard order, and both themes.

## Task 5: Add Chat, People, and Activity companion behavior

**Files:**

- Create: `src/server/db/schema/chat.ts`
- Create: `src/server/chat/chat-policy.ts`
- Create: `src/server/chat/chat-service.ts`
- Create: `src/server/realtime/chat-events.ts`
- Modify: `src/server/profile/chat-mute-service.ts`
- Create: `src/features/room/ChatPanel.tsx`
- Create: `src/features/room/ChatMessage.tsx`
- Create: `src/features/room/ChatComposer.tsx`
- Create: `src/features/room/PeoplePanel.tsx`
- Create: `src/features/room/ActivityPanel.tsx`
- Create: `src/features/room/typing-presence.ts`
- Create: `tests/unit/chat-policy.test.ts`
- Create: `tests/integration/chat-realtime.test.ts`
- Create: `tests/e2e/room-companions.spec.ts`

**Step 1: Write failing chat/activity tests**

Cover:

- at most 50 most recent persisted messages in canonical order on first admission;
- no older pagination and no reconnect backfill;
- normalized Unicode plain text up to 500 visible characters;
- safe `http`/`https` links only; no Markdown/embed behavior;
- local Pending → canonical acknowledgement replacement;
- failed send stays local with Retry/Discard and never enters another client or Transcript;
- immutable sent messages;
- each other Account's chat message exposes an accessible Mute action; successful mute immediately filters that Account from both the initial 50-message projection and subsequent realtime/typing presentation without affecting presence/media or notifying the target; `/profile` remains the management/unmute path;
- Activity begins empty and contains only canonical post-admission room events;
- Activity excludes passwords, reports, sanctions, moderation text, and unauthorized identities;
- typing refresh at most every two seconds, expiry at five seconds, and cancellation on empty/blur/send/leave/disconnect.

**Step 2: Implement server authority**

Validate, rate-limit, persist, and acknowledge chat before broadcast. Enforce 30 messages/minute/Account/room through the shared Valkey fixed-window helper; rejection is explicit and recoverable, and Valkey loss fails chat sends closed. Use one server-assigned canonical message ID/order. Apply the authenticated viewer's persistent mute set from the Profile prerequisite to initial-history and per-viewer realtime/typing projections without emitting any mute event or notifying the target. Keep Activity realtime-only and non-persistent. Use Pacer `useThrottler` for typing; do not write a local throttle wrapper.

**Step 3: Implement companion UX**

Dock opens to Chat. Preserve session-local tab/draft/scroll state across collapse/drawer/sheet presentation. Chat and Activity auto-follow only while already anchored at the bottom; otherwise preserve position and expose New messages. Hidden tabs show unread badges. People orders Host, You, active streamers, then continuous join order. Chat message actions use native popover/top-layer behavior and expose only the working Mute action at this stage; Mute calls the Profile prerequisite's canonical service and removes matching visible messages only after acknowledgement. Task 9 adds the working Report action when report authority exists.

**Step 4: Verify and commit**

Use two browser contexts for pending/canonical ordering, failure retry, unread, typing, mute, and Activity separation. Commit after integration and browser tests pass.

## Task 6: Implement compatibility gate and screen-capture state machine

**Files:**

- Create: `src/features/room/media/compatibility.ts`
- Create: `src/features/room/media/capture-controller.ts`
- Create: `src/features/room/media/useOwnStream.ts`
- Modify: `src/features/room/RoomControlShelf.tsx`
- Modify: `src/server/db/schema/streams.ts`
- Create: `src/server/streams/stream-service.ts`
- Create: `src/server/realtime/stream-events.ts`
- Create: `tests/unit/compatibility.test.ts`
- Create: `tests/unit/capture-controller.test.ts`
- Create: `tests/integration/stream-lifecycle.test.ts`
- Create: `tests/e2e/own-stream.spec.ts`

**Step 1: Write failing media-state tests**

Cover:

- publishing enabled only on supported Chromium-family desktop clients;
- mobile shows `Desktop only` without invoking capture;
- compatibility failure remains admitted with chat/presence/Previews and a Retry path;
- Start invokes the native picker only after an explicit user action;
- usable tracks enter Starting with Cancel;
- server acknowledgement enters canonical Live/Stop;
- denial, cancellation, unsupported capture, unusable tracks, or startup failure releases tracks and creates no Stream/Preview/peer/activity state;
- browser capture end uses canonical Stop;
- changing source requires Stop then another explicit Start;
- captured audio uses only tracks supplied by the picker.

**Step 2: Implement a small capture controller**

Model `idle | picking | starting | live | failed` with explicit cleanup. Keep raw `MediaStream`/tracks out of Query and server projections. Cancel aborts pending server startup, releases tracks, and returns to idle. Never automatically reopen the picker.

**Step 3: Implement authorized Stream service**

Create a canonical Stream only after usable tracks exist and the admitted member sends the authorized start command. Enforce one active own Stream and 10 start/stop commands/minute/Account/room through the shared Valkey limiter. Stop invalidates all subscriptions and signaling rights for that Stream. Rate-limit rejection is explicit and Valkey loss fails new start/stop mutations closed without removing membership.

**Step 4: Verify and commit**

Use synthetic Playwright media plus direct unit fakes for denial/end/cancel. Assert track cleanup and absence of canonical side effects.

## Task 7: Implement preview capture, upload, privacy, and serving

**Files:**

- Create: `src/features/room/media/preview-capture.ts`
- Create: `src/features/room/media/usePreviewUpload.ts`
- Create: `src/server/streams/preview-service.ts`
- Create: `src/server/http/preview-endpoint.ts`
- Create: `src/routes/api/stream-previews/$previewId.ts`
- Create: `tests/unit/preview-throttle.test.ts`
- Create: `tests/integration/preview-endpoint.test.ts`
- Create: `tests/e2e/stream-preview.spec.ts`

**Step 1: Write failing preview tests**

Prove the first usable preview uploads immediately; interim captures collapse to the latest; trailing upload occurs at the 120-second boundary; stop/leave/unmount cancels pending work and aborts in-flight upload; stale Stream uploads are rejected; public previews are unblurred; private previews are served only as server-produced blurred derivatives; only the latest active image is visible; payload type/dimensions, the 100 KB cap, and one upload/110 seconds/Stream session are enforced through Valkey.

**Step 2: Implement the minimum storage boundary**

Use the selected deployment's local persistent storage path plus an opaque preview key referenced by the Stream row. Keep one current preview per active Stream and separately freeze report evidence only when a report requires it. Register upload/read through the TanStack Start server entry at `src/routes/api/stream-previews/$previewId.ts`; the custom dev/production hosts require no special route branch. Public-room reads return the current public derivative, private-room discovery reads return only the server-produced blurred derivative, and stale/unauthorized originals are never reachable. Do not introduce object-storage infrastructure for V1.

**Step 3: Use Pacer's official throttler**

Use `useAsyncThrottler` with 120000ms, leading and trailing. Teardown calls `cancel()` and `abort()` and passes the current abort signal to the upload. Do not create a generic throttle abstraction.

**Step 4: Verify and commit**

Advance the controlled browser/test clock, verify cancellation reaches the request, and check Home plus Room projections show the same canonical preview. Exercise upload/read through both the development and built production single listener, including missing/stale IDs, privacy derivatives, content headers, Valkey failure, and path-containment attempts.

## Task 8: Implement native WebRTC signaling and one explicit watch

**Files:**

- Modify: `src/server/db/schema/subscriptions.ts`
- Modify: `src/server/streams/subscription-service.ts`
- Create: `src/server/realtime/signaling-events.ts`
- Create: `src/features/room/media/peer-connection.ts`
- Create: `src/features/room/media/watch-controller.ts`
- Create: `src/features/room/media/useWatchStream.ts`
- Create: `src/features/room/media/publisher-peer-registry.ts`
- Create: `src/features/room/media/usePublishStream.ts`
- Create: `src/features/room/WatchedStream.tsx`
- Modify: `src/features/room/MemberTile.tsx`
- Create: `tests/unit/watch-controller.test.ts`
- Create: `tests/unit/publisher-peer-registry.test.ts`
- Create: `tests/integration/signaling-authorization.test.ts`
- Create: `tests/e2e/watch-stream.spec.ts`

**Step 1: Write failing watch-state tests**

Cover:

- Preview never starts a connection;
- explicit Watch creates one subscription and one peer connection;
- every watch starts muted;
- selecting another Stream stops the former subscription before attempting the next;
- failure never restores the former watch;
- one AsyncRetryer per explicit Watch/Retry, four total attempts with 1/2/4-second waits and zero jitter;
- Stream end/change, selection change, leave, cancellation, sanction, room end, or admission loss aborts retry, closes peer connection, and discards the retryer;
- exhaustion returns to Preview with manual Retry/guidance;
- later Stream from the same member requires another explicit Watch.
- an active publisher consumes authorized subscription/signaling events, attaches the current capture tracks, answers negotiation, and owns at most nine outbound peer connections keyed by opaque subscription ID;
- viewer and publisher both close exactly the affected peer connection on subscription cancellation, Stream stop, displacement, leave, sanction, admission loss, or room end.

**Step 2: Implement server subscription authority**

Persist or canonically track one active remote subscription per viewer. Every offer, answer, and ICE command validates authenticated current connection, admitted membership, current Stream, current subscription/publisher authority, and room lifecycle. Payloads use opaque Stream/subscription IDs, bounded strings/arrays, and never arbitrary destination socket/Account authority.

**Step 3: Implement the browser peer controller**

Use browser-native `RTCPeerConnection` with configured public STUN and no TURN. The viewer watch controller creates the offer, buffers ICE until remote description, attaches received tracks, and owns the single inbound connection. `usePublishStream` mounts only while the canonical own Stream and local capture exist; it consumes authorized subscription/offer/answer/ICE/revocation events, asks `publisher-peer-registry` for one outbound connection per subscription, attaches the current capture tracks, sends answers/candidates through Socket.IO, and caps the set at nine. Both controllers route every signaling branch by opaque subscription ID, reject stale Stream generations, and perform idempotent targeted/all-close teardown. Socket.IO never receives audio/video.

**Step 4: Implement watched-tile controls**

Persistent footer below contained media includes identity/status, watcher count, connection/retry state, Mute/Unmute, Stop Watching, and native Fullscreen. Never overlay essential controls on video.

**Step 5: Verify and commit**

Run viewer and publisher unit state-machine tests, the full role × signaling-command × state integration matrix, and two-context synthetic-media Playwright flows that assert actual remote track receipt. Test stale/replayed/reordered signaling, the nine-outbound cap, replacement of capture generations, and zero forwarding or leaked peer connections after denial/revocation.

## Task 9: Implement leave, room settings, Host actions, reporting, and sanctions

**Files:**

- Create: `src/server/db/schema/moderation.ts`
- Create: `src/server/moderation/room-moderation-service.ts`
- Create: `src/server/moderation/report-service.ts`
- Create: `src/features/room/LeaveRoom.tsx`
- Create: `src/features/room/RoomSettings.tsx`
- Create: `src/features/room/RoomBanList.tsx`
- Create: `src/features/room/TransferHostDialog.tsx`
- Create: `src/features/room/ReportDialog.tsx`
- Create: `src/features/room/TileActions.tsx`
- Modify: `src/features/room/PeoplePanel.tsx`
- Modify: `src/features/room/ChatMessage.tsx`
- Create: `tests/integration/room-authorization-matrix.test.ts`
- Create: `tests/integration/report-intake.test.ts`
- Create: `tests/e2e/room-moderation.spec.ts`

**Step 1: Write the failing authorization matrix**

For every command, cover anonymous, authenticated non-member, Member, Host, Platform Admin, sanctioned, deletion-pending, displaced, reconnecting, and stale-session states. Denial asserts no database mutation, broadcast, signaling forward, private-data exposure, or unintended Valkey mutation.

Commands include leave, update metadata/privacy, rotate password, kick, ban, clear ban, stop Stream, transfer Host, report Account/room/Stream/message, and relevant sanction effects.

**Step 2: Implement focused behaviors**

- Ordinary non-Host non-streamer leaves immediately.
- Host and/or active streamer sees one confirmation naming Host transfer and/or Stream stop consequences.
- Metadata settings edit name/category/tags/visibility in one responsive dialog.
- Public → Private requires a new password; Private → Public confirms and clears it.
- Password rotation stores only a replacement hash, never reveals the password, retains existing admitted members, and applies the new password to future/rejoining members.
- Kick removes without ban; ban removes and blocks re-entry until cleared/room end.
- Host Stop affects only the current Stream.
- Transfer is immediate to one current member.
- Reporting a currently watched Stream stops only the reporter's local watch after successful submission.
- Reports enforce 10/hour/Account through the shared Valkey limiter; rejection is explicit and Valkey loss fails report submission closed.

Use native dialog/popover behavior and shared semantic controls already proven on Home. Do not add Host-written reasons, temporary bans, or an Admin dashboard.

**Step 3: Implement structured report intake**

Validate one existing target of Account, room, Stream, or chat message plus exactly one reason: harassment/hate; sexual/explicit content; violence, threats, or self-harm; privacy/impersonation; spam/scam; copyright; or other. `other` requires normalized non-empty details within the bounded report text limit; reasons never become freeform Host/moderation commands. Validate that the target and any Stream/message generation still belong to the identified room context before committing.

Persist reports unresolved until an Admin resolves/dismisses them. Resolution/dismissal starts the one-year retention deadline. A Stream report atomically freezes the current canonical preview as evidence before later Stream/preview cleanup; ordinary preview rotation cannot delete frozen evidence. Report content and frozen evidence are available only to authorized moderation services and never enter public projections, Chat, Activity, or ordinary room broadcasts. Integration tests prove those data boundaries; manual log/PostHog review remains the explicit ADR 0106 telemetry exception.

The dialog presents the seven named reasons, conditionally requires details for `other`, identifies the target clearly, preserves input on recoverable failure, and stops the reporter's watched Stream only after canonical submission succeeds.

**Step 4: Verify and commit**

Use Host/member/Admin browser contexts for representative UI outcomes and direct Socket.IO clients for the exhaustive authorization matrix. Run the focused report-intake integration suite for taxonomy, target validation, frozen evidence, one-year deadline start, private projection boundaries, and watched-Stream local stop.

## Task 10: Complete mobile companions and responsive interaction recovery

**Files:**

- Create: `src/features/room/RoomMobileBar.tsx`
- Create: `src/features/room/RoomSheet.tsx`
- Modify: `src/features/room/RoomWorkspace.tsx`
- Modify: `src/features/room/RoomCompanion.tsx`
- Modify: `src/features/room/RoomMosaic.tsx`
- Create: `tests/e2e/room-mobile.spec.ts`

**Step 1: Write failing mobile interaction tests**

Cover compact Back/name/privacy/countdown header, Details metadata/settings, contextual Stream/Chat/People/Activity/Leave-More bar, `Desktop only` publishing state, two-column no-watch overview, primary watched stage, horizontal remaining-member strip, 55% and 90% sheet heights, labeled Expand/Collapse, software keyboard behavior, focus return, safe areas, and no global Home/Create/Profile bar while admitted.

**Step 2: Implement one sheet primitive**

Use native dialog/top-layer behavior with two explicit heights. Share it among Chat, People, Activity, and Details. Do not install a drawer/sheet package or create separate component trees for mobile companion content.

**Step 3: Verify and commit**

Run current Playwright Chromium small-device projects for every PR. Keep WebKit compatibility checks focused. Real iOS Safari and Android Chrome remain scheduled qualification per ADR 0106.

## Task 11: Implement reconnect, failure, forced-departure, and end recovery UX

**Files:**

- Create: `src/features/room/RoomRecovery.tsx`
- Create: `src/features/room/room-recovery.ts`
- Modify: `src/features/room/RoomRoute.tsx`
- Modify: `src/features/room/media/capture-controller.ts`
- Modify: `src/features/room/media/watch-controller.ts`
- Create: `tests/integration/room-recovery.test.ts`
- Create: `tests/e2e/room-recovery.spec.ts`

**Step 1: Write failing recovery tests**

Cover:

- compatibility failure → inline chat-only banner with Retry;
- unexpected Socket.IO loss → immediate own/watched media close plus 45-second reclaim state;
- successful reclaim → admitted membership restored, no automatic Start/Watch;
- reclaim expiry → pre-admission or ended projection based on canonical room state;
- kick, ban, displacement, all-access sanction, or admission loss → media teardown and same-URL pre-admission with generic messaging;
- streaming sanction → current Stream stops and Start disables without removing membership;
- chat sanction → composer disables without removing membership or stored chat;
- lifetime/Admin end → immediate media teardown and same-URL Past Stream;
- STUN/ICE failure → chat/presence retained, bounded retry exhausted, manual Retry guidance;
- PostgreSQL/Valkey failures follow their documented authority boundaries.

**Step 2: Centralize teardown, not state**

Implement one idempotent Room media teardown function invoked by all terminal membership/Stream/subscription events. Keep canonical state in server projections and media state in controllers; do not invent a generic application state machine.

**Step 3: Verify and commit**

Use controlled clocks, deterministic adapter failures, selected real service pause/drop tests, and browser traces. No arbitrary sleeps or silent retry-to-green behavior.

## Task 12: Smoke-test the complete Room route, then perform final plan cleanup

**Files:**

- Modify only files exposed by the smoke test
- Add no abstraction unless current code has at least two concrete consumers

**Step 1: Run focused verification**

```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e -- --project=chromium tests/e2e/room-shell.spec.ts tests/e2e/room-mosaic.spec.ts tests/e2e/room-companions.spec.ts tests/e2e/own-stream.spec.ts tests/e2e/stream-preview.spec.ts tests/e2e/watch-stream.spec.ts tests/e2e/room-moderation.spec.ts tests/e2e/room-mobile.spec.ts tests/e2e/room-recovery.spec.ts
pnpm build
```

Expected: all exit 0; no test succeeds only on retry.

**Step 2: Run the representative multi-user journey**

With separate Host, Member, second Member, and Platform Admin contexts:

1. create and enter a room;
2. admit members and verify stable ordering;
3. send canonical chat and Activity events;
4. Start synthetic screen capture, Cancel once, then Start successfully;
5. Watch explicitly, switch watcher, stop/restart Stream, and require explicit re-watch;
6. transfer Host, kick, rejoin, ban, clear ban, and report;
7. disconnect/reclaim without media restoration;
8. force expiry/Admin end and observe in-place Past Stream.

Run at wide, medium, and small stages in both themes. Add selective visual baselines for stable shell, watched mosaic, companion, chat-only compatibility, reconnect, and Past Stream states.

**Step 3: Check hard boundaries**

Confirm:

- Socket.IO never carries captured media;
- no PeerJS/PeerServer/TURN/SFU dependency or route exists;
- no Account holds two memberships or two remote subscriptions;
- no Stream/watch restarts automatically;
- private identities/passwords never leak;
- forced events close tracks and peer connections exactly once;
- Home query projections update correctly when Room events change membership/Stream/preview state;
- transcript/admin/profile standalone routes remain out of scope;
- responsive variants share canonical state and semantic content rather than duplicating behavior.

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify complete Room route contract"
```

## Room plan completion criteria

The route is complete only when the same stable URL safely transitions among pre-admission, admitted room, forced recovery, and Past Stream; multiple Accounts can chat and observe canonical presence; supported desktop publishers can explicitly start/stop synthetic or real browser-picked capture; admitted viewers can explicitly watch exactly one remote Stream through native WebRTC; Host/report/sanction behavior is authorized and observable; reconnect and end paths tear media down without automatic restoration; and wide, medium, and small presentations preserve keyboard, focus, accessibility, and state contracts.
