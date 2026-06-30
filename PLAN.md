# Stream Room Validation and Implementation Plan

> REQUIRED SUB-SKILL: Use executing-plans style task-by-task execution. Current mode: `/ponytail ultra` — smallest working changes, no speculative abstractions.

## Goal
Validate and, where broken, implement the seven Stream Room behaviors requested by the user: live member surfaces, chat, feed, stream availability, watch connection/media controls, streamer controls placement, and MediaCapture preview.

## Architecture
Use the existing single-origin TanStack Start + Socket.IO room protocol. Socket.IO owns live membership, chat, stream availability, feed activity, watch commands, and WebRTC signaling; media stays browser P2P. Keep one room socket source of truth for the page and derive header/sidebar/mosaic/feed/chat from the canonical `room:join` snapshot plus room broadcasts.

## Tech Stack
React, TanStack Start file route `src/routes/rooms/$roomId.tsx`, Socket.IO client/server, Drizzle-backed room/chat/stream services, browser `navigator.mediaDevices.getDisplayMedia`, WebRTC `RTCPeerConnection`, Vitest, Playwright where browser behavior is required.

## Documentation contract read
- Product language: `CONTEXT.md`.
- Source-of-truth order: `docs/README.md`.
- Room UI and loader contract: `docs/routes.md`.
- Realtime commands and broadcasts: `docs/socket-events.md`.
- E2E/unit coverage expectations: `docs/testing.md`.
- Stream/P2P decision: `docs/adr/0001-peer-to-peer-media.md`.
- Socket.IO signaling boundary: `docs/adr/0003-socket-io-room-signaling.md`.
- Validation/testing: `docs/adr/0004-validation-and-testing.md`.
- Single origin: `docs/adr/0005-single-origin-start-and-socket-io.md`.
- V1 data model: `docs/adr/0006-v1-data-model.md`.
- Realtime protocol: `docs/adr/0007-realtime-protocol.md`.
- UI flows: `docs/adr/0008-v1-ui-flows.md`.
- UI stack: `docs/adr/0009-ui-implementation-stack.md`.
- Rate limits: `docs/adr/0010-valkey-rate-limiting.md`.
- Schema/config/observability/build-order docs: `docs/schema.md`, `docs/drizzle-schema.md`, `docs/configuration.md`, `docs/observability.md`, `docs/implementation-plan.md`, `docs/production-audit-plan.md`.

## Current observed gaps to verify before editing
1. `src/routes/rooms/$roomId.tsx` renders topbar count and sidebar people/chat/feed placeholders from static loader summary, not live Socket.IO state.
2. `RoomStreamPanel` opens its own socket and emits `room:join`; the route sidebars do not share that live state.
3. Chat UI text/input exists but has no visible `chat:send`/`chat:message` behavior in the route component.
4. Feed tab is static; join/leave/start/stop events are not rendered as feed updates.
5. Stream availability is partially handled by `stream:started`, but streamer identity/member tile state and topbar/sidebar counts are not reconciled.
6. Watch WebRTC is partially implemented through `watch:start`, `signal:*`, and `RTCPeerConnection`; tile controls need actual mute/fullscreen behavior.
7. Streamer start/stop controls currently live in the mosaic tile; requested placement is bottom of the stream page, not in the room mosaic tile.
8. `getDisplayMedia` is used; preview should be verified with fake media and kept on the current user's tile.

## Task 1: Build a single live room state model
**Files**
- Modify: `src/routes/rooms/$roomId.tsx`
- Modify: `src/components/room-stream-panel.tsx`
- Test: focused existing room route/stream panel tests, plus a new source/behavior test if no DOM harness exists.

**Steps**
1. Write a failing test proving the room page owns and passes live members/messages/feed/streams into the mosaic/sidebar instead of rendering only placeholder text.
2. Run the focused test and confirm it fails for missing live state wiring.
3. Move the room socket connection to the route or a minimal local hook in the route file; avoid a new abstraction unless the route becomes unreadable.
4. On `room:join` ack, store canonical `room`, `members`, `streams`, and `recentMessages`.
5. On `member:joined`/`member:left`, update members, topbar count, people list, feed.
6. Pass active streams/current user state into `RoomStreamPanel`; remove duplicate `room:join` from the panel.
7. Run the focused test green.

## Task 2: Validate/implement join surfaces
**Acceptance point**: Someone joins room -> their mosaic tile gets added on all existing room users screens and right sidebar and topbar user list/count.

**Files**
- Modify: `src/routes/rooms/$roomId.tsx`
- Modify: `src/components/room-stream-panel.tsx`
- Test: route/panel focused tests.

**Steps**
1. Write a failing test for `member:joined` adding a non-streaming member tile, People row, and incremented topbar count.
2. Run red.
3. Render one Room Member Tile per live member. Non-streaming members get compact tiles; streaming members get preview/subscribed/local states.
4. Sort streaming members first by stream `startedAt`, then non-streaming by `joinedAt`, matching docs.
5. Update People tab from live member state, not loader summary strings.
6. Run green.

## Task 3: Validate/implement room chat
**Acceptance point**: Room chat should work.

**Files**
- Modify: `src/routes/rooms/$roomId.tsx`
- Test: route focused test and existing realtime backend test if needed.

**Steps**
1. Write a failing test that typing/submitting chat emits `chat:send` and a `chat:message` broadcast appears in the chat list.
2. Run red.
3. Render recent messages from `room:join` ack.
4. Add controlled chat input; submit on Enter/button; emit `chat:send` with `{ roomId, body }`.
5. On `chat:message`, append message and clear input only after successful ack.
6. Surface ack error as short inline status; do not log message body.
7. Run green.

## Task 4: Validate/implement Feed tab events
**Acceptance point**: Feed tab sends updates whenever someone joins, leaves, starts stream, or stops stream.

**Files**
- Modify: `src/routes/rooms/$roomId.tsx`
- Modify: `src/components/room-stream-panel.tsx` only if stream events stay there temporarily.
- Test: route focused test.

**Steps**
1. Write a failing test for feed entries from `member:joined`, `member:left`, `stream:started`, and `stream:stopped`.
2. Run red.
3. Add a tiny `feedItems` state array in the route.
4. Append human-readable feed rows on the four broadcasts.
5. Keep messages deterministic and terse: joined, left, went live, stopped stream.
6. Run green.

## Task 5: Validate/implement stream start broadcast state
**Acceptance point**: Someone starting stream broadcasts to everyone else by showing View Stream and Live on streamer's mosaic tile.

**Files**
- Modify: `src/components/room-stream-panel.tsx`
- Modify: `src/routes/rooms/$roomId.tsx`
- Test: stream panel focused test.

**Steps**
1. Write a failing test that a remote `stream:started` event marks the streamer's tile `Live` and renders `View Stream`.
2. Run red.
3. On `stream:started`, merge the stream by `streamSessionId` and mark that member streaming.
4. Render remote active stream as preview tile with `Live` pill and `View Stream` button.
5. On `stream:stopped`, remove that stream, close any related peer, clear live state on that member.
6. Run green.

## Task 6: Validate/implement View Stream PeerJS/WebRTC and controls
**Acceptance point**: View Stream automatically sets up peer connection and puts stream video in mosaic tile. Bottom-right controls are mute and fullscreen; both work.

**Files**
- Modify: `src/components/room-stream-panel.tsx`
- Test: stream panel focused test; browser-level Playwright only if unit/jsdom cannot cover fullscreen/media state.

**Steps**
1. Write a failing test that clicking `View Stream` calls `watch:start`, creates a peer offer, and renders the remote stream in the streamer tile.
2. Run red.
3. Keep existing WebRTC signaling path; fix only broken state/control wiring.
4. Put remote stream on the matching streamer's tile video, not a single shared remote ref when multiple streams exist.
5. Add bottom-right `Mute` toggle that sets the tile video `muted` property.
6. Add bottom-right `Fullscreen` button that calls `requestFullscreen()` on that tile/video element.
7. Keep 3 attempts over 15 seconds and manual Retry after `CONNECTION_FAILED`.
8. Run green.

## Task 7: Validate/implement streamer controls placement
**Acceptance point**: Streamer controls should be on the bottom of their stream page, not in room mosaic tile.

**Files**
- Modify: `src/routes/rooms/$roomId.tsx`
- Modify: `src/components/room-stream-panel.tsx`
- Test: room route/stream panel focused tests.

**Steps**
1. Write a failing test that current user's mosaic tile has no Start/Stop stream buttons and bottom dock has the streamer controls.
2. Run red.
3. Move Start/Stop stream actions to the room bottom dock or bottom stream controls area.
4. Pass `startSharing`/`stopSharing` handlers or an equivalent minimal control API from `RoomStreamPanel` to the route only if needed; otherwise render the bottom control from the panel outside the mosaic grid.
5. Keep non-streaming current user's tile as visual idle state only.
6. Run green.

## Task 8: Validate/implement MediaCapture and local preview
**Acceptance point**: Start stream brings up browser MediaCapture selection/settings; after selection captures selected source. Preview shows to streamer on own mosaic tile.

**Files**
- Modify: `src/components/room-stream-panel.tsx`
- Test: `src/lib/streaming-client.test.ts`, stream panel focused test, Playwright media stub if available.

**Steps**
1. Write a failing test/stub proving Start stream calls `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })` from user action.
2. Run red.
3. Ensure success sets local stream on current user's tile video and emits `stream:start` with `streamTrackSummary` metadata.
4. Ensure user cancel leaves status ready and does not emit `stream:start`.
5. Ensure video track `ended` triggers stop sharing.
6. Run green.

## Task 9: Focused verification
**Commands**
- `pnpm test src/routes/rooms/-roomId.test.ts src/components/room-stream-panel.test.ts src/lib/streaming-client.test.ts`
- Add any new focused test command needed by changed files.
- If browser media behavior changed and e2e harness is available, run the narrow Playwright stream-room spec.

## Non-goals for this pass
- Admin dashboard.
- Reconnect grace and duplicate active room takeover unless directly blocking the seven requested behaviors.
- Full production hardening beyond the requested room stream flow.
- New libraries; existing WebRTC + Socket.IO is enough.
