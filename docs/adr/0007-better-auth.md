# 7. Better Auth for Discord OAuth and sessions

Date: 2026-09-27 · Status: accepted

## Decision
Use Better Auth with the Discord social provider, the Drizzle adapter (Postgres), and database-backed sessions in an httpOnly cookie. Use its admin plugin (roles, ban) and built-in rate limiting (ADR 6). The WebSocket upgrade authenticates by validating the same session cookie. Unauthenticated upgrades are rejected.

## Consequences
- Auth tables are owned by Better Auth's schema and generated into the Drizzle schema.
- The Discord username/avatar are stored at sign-in; the profile's "discord" field comes from there.

> Amended by ADR 20: unauthenticated upgrades are accepted into a read-only lobby channel only.

## Addendum: Discord pictures in avatars (2026-09-30)
- The stored avatar (`user.image`) is shown in every avatar, to everyone who sees the user, with the user's initials as the fallback when there is none or it fails to load (Discord's hashes change with the picture, so a stored URL can go stale until the next sign-in).
- `image` is server-owned: only the Discord sign-in writes it, refreshed on every sign-in. Better Auth's `/update-user` refuses a request that carries `image`, as it does `discordId` and `discordUsername`, since anyone could otherwise point their picture at a tracking URL and log other viewers' IPs.
- The UI loads a picture only from `https://cdn.discordapp.com` (https, that host, no credentials), whatever is stored, and asks Discord for a size that fits the avatar.

## Addendum: display name is server-owned (2026-10-02)
- `name`, the display name shown in profiles and search, joins `image`, `discordId` and `discordUsername` as server-owned: Better Auth's `/update-user` refuses a request that carries it. The app never edits it, and `/update-user` accepted a 300,000-character one, or another user's name. Only the Discord sign-in writes it (global name, else username), refreshed on every sign-in.
- The ban notice on home takes its description from the URL (`?error=BANNED_USER&error_description=…`), which anyone can write. It shows the description only when it has the shape `describeBan` produces (a reason of at most 200 characters or "No reason was given", then the expiry or "The ban has no end date"), for the `BANNED_USER` error only. Anything else shows the generic "Your account is banned" notice. A real refused sign-in and the realtime ban disconnect both send that shape. A crafted link can still put its own text in the reason slot, bounded to 200 characters inside the "Reason: …" frame.

## Addendum: admin plugin and account-linking routes closed over HTTP (2026-09-30)
- Every admin plugin path, plus `/link-social`, `/unlink-account` and `/update-session`, is in `disabledPaths` and answers 404 over HTTP. Better Auth's other core routes stay open (sign-in and callback, `get-session`, sign-out, `/update-user` with the guards above, session listing and revoking, and so on); those that need email/password or account deletion are refused by configuration. The admin paths come from the plugin's own endpoints, so a Better Auth upgrade that adds one is closed too, and a test fails if one is open.
- Admin actions happen only through the app's server functions (`src/server/admin-users.ts`), which call `auth.api.banUser`, `unbanUser` and `setRole` server-side (`disabledPaths` applies only to the HTTP router). Those enforce the app's rules (ADR 6: admins can't be banned, env admins and the last admin can't be demoted, no self-demotion) and write the audit log, which the plugin's own routes skip. The browser client no longer includes the admin plugin.

## Addendum: a session that ends closes its sockets (2026-10-03)
A socket authenticated at its upgrade used to outlive its session: signing out, revoking sessions, or an expired session left it open, signed in, until it dropped (only a ban closed it).
- The upgrade records the session's id with the socket (`RoomHub.connect`). Better Auth's `session.delete.after` database hook (`src/lib/auth.ts`) runs for every way a session row goes (sign-out, revoke one, all or all others, a user's removal, an expired session found at a request) and calls `RoomHub.sessionEnded(sessionId)` through the live hub (`src/server/live-hub.ts`). Every socket opened with that session closes with `SESSION_ENDED_CLOSE_CODE` (4003); its user is as after any lost socket (reconnect grace in a room, then they leave). Sockets of the user's other, still-valid sessions stay open. The hook doesn't wait for the hub, so sign-out isn't held up by its queue.
- A ban revokes the user's sessions as well, but the hook skips it (`/admin/ban-user`): the hub's `disconnectUser` tells their sockets `banned` and closes them with `BANNED_CLOSE_CODE`, which a plain close would pre-empt.
- Not covered: a session that merely expires with no request ever made with its cookie leaves no event, so its open socket stays until it closes (a tab left open for the whole session lifetime). A socket whose upgrade is being authenticated when its session ends isn't known to the hub yet and also stays open. Both would need the socket's session re-checked from time to time.
