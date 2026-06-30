# Test Catalog

V1 uses Vitest for unit/integration tests and Playwright Chromium for browser e2e. Playwright uses deterministic seed data, test-only auth bypass, multiple browser contexts, and stubbed browser media APIs for stream tests.

## Playwright Chromium e2e

### App shell and auth

- Loads authenticated app shell via test-only auth bypass.
- Rejects unauthenticated access to authenticated routes.
- Shows admin navigation only for accounts in `ADMIN_DISCORD_IDS`.
- Uses one public origin for app routes and Socket.IO.

### Discovery and room cards

- Shows public live rooms and Past Stream cards.
- Private listed rooms show lock state and hide participant names/avatar stacks.
- Discovery updates when a room is created, revived, or ended.
- Room search/category/tag filtering reflects seeded rooms.
- Nightly stats surfaces show `lastUpdatedAt`.

### Room creation

- Creates public room with name, category, and up to five tags.
- Creates private room only when password is provided.
- Rejects invalid room name length and tag count/length.
- Enforces room-creation platform sanction.
- Shows rate-limit error after Valkey room-create limit is exceeded.

### Public room join and lifecycle

- Joins public room until hard capacity of 10 members.
- Rejects join when room is full unless user owns a reconnect slot.
- Starts 60-second reconnect grace after transient disconnect.
- Replacing an existing account+room socket stops old socket state.
- Host handoff occurs only after host exceeds reconnect grace or leaves.
- Empty room enters `empty_grace` and revives when a user joins within five minutes.
- Empty room becomes ended/Past Stream after grace expires.

### Private room join

- Opening a private room card shows password modal.
- Wrong password stays in modal with error and does not join Socket.IO room.
- Correct password joins room.
- Password-attempt Valkey limit returns visible error.

### Chat and transcript behavior

- Sends valid chat, persists it, and broadcasts canonical message ID/timestamp to other users.
- Rejects invalid/empty/oversized chat through UI error.
- Enforces chat platform sanction.
- Enforces chat rate limit.
- Temporarily disconnected user does not receive offline backfill on reconnect.

### Stream UI and media stubs

- Non-Chromium stream start gate is covered outside Playwright Chromium by unit/integration compatibility checks; Chromium e2e verifies stream start UI is available.
- Stubs `navigator.mediaDevices.getDisplayMedia` with deterministic fake media streams.
- Starting a stream creates a local preview tile and broadcasts stream availability.
- Stream metadata shows actual `hasAudio`/`hasVideo` flags from fake tracks.
- Unsubscribed active streams render blurred preview tiles with Watch control.
- Thumbnail upload cadence/size/rate-limit behavior is covered with deterministic fake thumbnail payloads.
- Watching a stream creates subscribed media tile state.
- Watch connection retries 3 attempts over 15 seconds before showing visible error and manual Retry.
- Manual Retry can recover from a previously failed watch attempt.
- Stop Watching returns to preview state.
- Streamer Stop Stream ends the stream for all viewers.
- Host Stop Stream ends another member's stream.
- Unexpected streamer disconnect stops active streams immediately.

### Host controls and room bans

- Host can open room settings moderation UI.
- Host can apply a Room Ban.
- Banned user is removed and cannot rejoin the live room.
- Host can clear a Room Ban.
- Cleared user can rejoin if capacity/password allow.
- Non-host cannot access host-only ban controls.

### Reports

- User can report a stream from tile menu.
- Stream report freezes latest blurred thumbnail snapshot when one exists.
- User can report member from People/member menu.
- User can report chat message from chat message menu.
- Report creation rate limit shows visible error.

### Platform admin and sanctions

- Platform Admin can view reports.
- Platform Admin can apply stream ban, chat ban, room-creation ban, and full suspension.
- Sanctioned user sees correct blocked action and stable error message.
- Platform Admin can lift sanctions.
- Platform Admin can end live room.
- Non-admin cannot access admin dashboard or admin Socket.IO/HTTP actions.

### Accessibility and motion smoke

- Dialogs, menus, tabs, and stream controls are keyboard operable.
- Visible focus appears on interactive controls.
- Reduced-motion preference disables non-essential motion.

## Vitest integration tests

Use integration tests rather than Playwright for protocol/state permutations that do not need a browser:

- Zod schemas for every HTTP and Socket.IO command payload.
- Room join gate ordering: auth, suspension, state, ban, password, capacity, reconnect slot.
- Host handoff timing and longest-joined selection.
- Empty room grace timers.
- Room capacity and reconnect slot accounting.
- Room ban effective/cleared semantics.
- Platform sanction effective/expired/lifted semantics.
- Valkey rate-limit key construction and expiry behavior.
- Socket.IO ack result shape and stable error codes.
- WebRTC signaling relay authorization by room/socket/stream state.
- Chat persist-then-broadcast ordering.
- Report target validation and thumbnail snapshot persistence.
- Nightly aggregate computation for user daily facts and unordered user-pair daily facts.

## Vitest unit tests

Use unit tests for pure logic:

- Category/tag/name validators.
- Public/private room card privacy projection.
- Compatibility-gate browser classification.
- Room state transition helpers.
- Rate-limit config/defaults.
- Stream tile state derivation.
- Admin allowlist parsing.
- Log redaction helpers.
