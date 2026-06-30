# TanStack Start Route Map

BhayanakCast uses TanStack Start file-based routing. The route map below is the v1 implementation contract.

Reference conventions from TanStack Start docs:

- Root layout: `src/routes/__root.tsx`.
- Home page: `src/routes/index.tsx`.
- Static route `/posts`: `src/routes/posts.tsx`.
- Dynamic route `/posts/$slug`: `src/routes/posts/$slug.tsx`.
- API route `/api/endpoint`: `src/routes/api/endpoint.ts`.

## Route principles

- Product routes share the authenticated app shell with the narrow left rail.
- Unauthenticated users see the public shell/home with a “Continue with Discord” action; there is no dedicated `/login` page.
- Room URLs use opaque room IDs: `/rooms/$roomId`.
- Public profile URLs use opaque user IDs: `/users/$userId`; `/profile` is the current-user shortcut.
- Admin UI is a single `/admin` page with tabs, not nested admin routes.
- Create Room and room settings are in-place modals, not routes.
- Product live mutations use Socket.IO commands from [`socket-events.md`](./socket-events.md). HTTP routes are minimal.

## Page route files

```txt
src/routes/
  __root.tsx
  index.tsx
  rooms/$roomId.tsx
  profile.tsx
  users/$userId.tsx
  admin.tsx
```

### `src/routes/__root.tsx`

Path: root layout.

Purpose:

- Defines `<html>`, `<head>`, global CSS link, scripts, global error boundary, not-found component.
- Creates TanStack Router context with `QueryClient`.
- Provides global providers: QueryClient, theme, socket client bootstrap as needed.
- Renders authenticated app shell/rail for product routes when a session exists.
- Renders unauthenticated shell state when no session exists.

Auth:

- Does not require auth itself.
- Loads current session for route context.

Data:

- Session/current user.
- Platform-admin flag derived from static Discord ID allowlist server-side.

Design notes:

- The narrow rail belongs here or in an immediate app-shell component used here.
- Rail actions: Active Rooms, Start Room modal, Admin Dashboard if platform admin, theme toggle, current profile.

### `src/routes/index.tsx`

Path: `/`

Purpose:

- Active Rooms discovery page.
- Public unauthenticated landing action: “Continue with Discord”.
- Authenticated home shows live rooms, Past Streams, stats cards, community/admin-adjacent metrics, and Join/Get Started panel from the design.

Auth:

- Publicly reachable.
- Unauthenticated users cannot join/create rooms; CTA starts Discord auth.

Data:

- Loader preloads discovery room summaries and Past Stream cards via TanStack Query/server loader.
- Client joins Socket.IO `discovery` room after hydration/session to receive live updates.

UI state:

- Search/category/tag filters are local route/component state unless implementation chooses search params later.
- Create Room opens modal; not a route.
- Private room join opens password modal.

### `src/routes/rooms/$roomId.tsx`

Path: `/rooms/$roomId`

Purpose:

- Live room page.
- Central mosaic with subscribed streams, blurred previews, and non-streaming member tiles.
- Right panel for chat, people, and feed/activity.
- Room header with members/capacity, active stream count, visibility, and current host.

Auth:

- Requires authenticated user.
- If unauthenticated, show auth-required state with Continue with Discord; do not join Socket.IO room.

Data:

- Loader fetches initial room summary, current user, room members, active streams, and not-found/ended/password states.
- Socket.IO `room:join` performs authoritative admission hydration and can replace stale loader data with canonical room, members, streams, recent messages.
- Route renders one Room Member Tile per admitted member from the current member list; it does not infer mosaic tiles from stream counts.
- Mosaic tile order is: streaming members first, then non-streaming members. Streaming members sort by oldest active stream first using `stream.startedAt ASC`; non-streaming members sort by `joinedAt ASC`. Host status never changes mosaic order. The current user's My Stream Tile follows the same ordering rules, so it can appear below other active streams when the current user is not streaming.
- V1 enforces one active stream per room member in a room; starting a new stream closes that member's previous active stream, and a Room Member Tile never represents multiple simultaneous streams.

UI states:

- Public join: route attempts `room:join` after socket/session ready.
- Private join: show password modal first unless password was already accepted in current client state.
- Full room: show `ROOM_FULL` state.
- Room ban: show `ROOM_BANNED` state.
- Ended room: show Past Stream history view, not live room controls.
- Bottom dock includes Leave plus stream controls for the current user. When the current user is not streaming, it shows Start stream; when streaming, it shows Stop stream. Leave sends the authoritative room leave command rather than acting as a static visual control.
- My Stream Tile shows idle self state when not streaming and local preview/status when streaming; it does not own Start stream or Stop stream actions.
- If the account already has an active room client for this room, a new tab/device must show confirmation before joining. Confirming makes the new tab/device the active room client and closes that account's other connections for this room only; canceling does not join. Closed room clients stop local stream/subscriptions and route to home. Other BhayanakCast rooms/pages are unaffected.
- Active-client takeover must be server-confirmed before rendering live room UI. A duplicate join first returns a warning state; after user confirmation, the client retries join with takeover intent and renders only after the server returns the canonical room snapshot.
- If the current user leaves while streaming, the client stops the current user's stream first, then sends `room:leave`, clears local room subscriptions/state, and navigates home. Stream stop is best-effort; leave should still proceed if stream cleanup fails.
- Connection failure: keep preview tile, show error and manual Retry after 3 attempts over 15 seconds.

Modals:

- Room settings/host moderation modal opens in-place.
- Report dialogs open in-place from tile/member/message menus.

### `src/routes/profile.tsx`

Path: `/profile`

Purpose:

- Current user's public-profile view and activity stats.
- Shortcut route to current user's profile data.

Auth:

- Requires authenticated user.

Data:

- Loader fetches current user profile summary, aggregate facts, rooms, and social stats.
- Stats must include `lastUpdatedAt`.

No settings route:

- Theme toggle lives in rail.
- V1 has no local username/profile-edit route because identity mirrors Discord.

### `src/routes/users/$userId.tsx`

Path: `/users/$userId`

Purpose:

- Public profile page for another account.
- Shows Discord-mirrored identity, aggregate usage stats, and top co-users from nightly facts.

Auth:

- Authenticated route for v1. Public discovery platform does not imply anonymous profile browsing unless explicitly added later.

Data:

- Loader fetches public profile projection.
- Must not expose admin-only fields, private transcripts, report contents, sanctions, or hidden participant data from private room cards.

### `src/routes/admin.tsx`

Path: `/admin`

Purpose:

- Platform Admin dashboard.
- Single page with tabs for Reports, Live Rooms, Sanctions, and Metrics.

Auth:

- Requires authenticated Platform Admin.
- Non-admin users receive not-found or forbidden UI; do not render admin shell state.

Data:

- Loader fetches initial open reports, live rooms, sanctions/metrics summary.
- Client sends `admin:join` Socket.IO command for live admin updates.

Tabs:

- Tabs are in component state or search param, not nested routes for v1.

## HTTP/API route files

```txt
src/routes/
  api/auth/$.ts
  api/health.ts
  api/test/session.ts
  api/streams/$streamSessionId/thumbnail.ts
  api/reports/$reportId/thumbnail.ts
  api/rooms/$roomId/transcript.ts
```

### `src/routes/api/auth/$.ts`

Path: `/api/auth/*`

Purpose:

- Better Auth handler/callback catch-all.
- Discord OAuth starts/callbacks flow through this handler.

Auth:

- Owned by Better Auth.

Notes:

- `BETTER_AUTH_URL` must match the public cloudflared/app origin to avoid OAuth callback mismatch.

### `src/routes/api/health.ts`

Path: `/api/health`

Purpose:

- Lightweight health check for app container/tunnel.

Response:

```ts
{
  ok: true
  service: 'bhayanakcast'
  time: string
}
```

Notes:

- Should not require auth.
- Should not expose secrets, DB URLs, Valkey URLs, or detailed internals.

### `src/routes/api/test/session.ts`

Path: `/api/test/session`

Purpose:

- Test-only auth bypass for Playwright/Vitest integration.
- Creates real signed-in sessions for deterministic seeded Better Auth users.

Availability:

- Only enabled in test runtime.
- Must return 404 or hard-fail outside test runtime.

### `src/routes/api/streams/$streamSessionId/thumbnail.ts`

Path: `/api/streams/$streamSessionId/thumbnail`

Purpose:

- Accepts authenticated stream thumbnail uploads from the active streamer.

Auth:

- Requires an authenticated user.
- User must own the active stream session.

Request:

- `POST` JSON `{ contentType, data }`, where `data` is base64 thumbnail bytes.

Response:

- `200` JSON `{ ok: true }` on accepted upload.

### `src/routes/api/reports/$reportId/thumbnail.ts`

Purpose:

- Serves frozen blurred report thumbnail snapshots from PostgreSQL `bytea`.

Auth:

- Platform Admin only.

Response:

- `200` `image/webp` or `image/jpeg`.
- `404` when the report has no snapshot or the report does not exist.

### `src/routes/api/rooms/$roomId/transcript.ts`

Path: `/api/rooms/$roomId/transcript`

Purpose:

- Serves retained room transcript chat messages after the room ends.
- Not used for public past-stream comments or reconnect backfill.

Auth:

- Requires authenticated user.
- User must be the room creator/current host or a Platform Admin.

Response:

- `200` JSON `{ room, messages }` ordered by message creation time.
- `403` non-host non-admin.
- `409` room has not ended.

## Non-routes

These are intentionally not routes in v1:

- `/login` — home/auth-required states start Discord auth directly.
- `/rooms/new` — Create Room is an in-place modal.
- `/rooms/$roomId/settings` — room settings/ban management is an in-place modal.
- `/settings` — no v1 user settings page.
- Nested `/admin/*` routes — admin uses tabs inside `/admin`.

## Loader and cache policy

- Use TanStack Start loaders with TanStack Query for non-realtime server state: discovery initial data, profile data, admin initial data, and room summary preflight.
- Socket.IO owns live membership, chat, stream availability, signaling, and admin live updates.
- Query cache should be invalidated or patched from Socket.IO broadcasts where useful; do not duplicate realtime state as stale query state.

## Implementation order impact

- Slice 1 creates `__root.tsx`, `index.tsx`, global shell, and `/api/health`.
- Slice 2 wires `/api/auth/$` and `/api/test/session`.
- Slice 3 adds `/rooms/$roomId`, `/profile`, `/users/$userId` loaders and room creation/join UI.
- Slice 5 adds `/admin`.
- Stream thumbnail endpoints are added with the stream slice.
