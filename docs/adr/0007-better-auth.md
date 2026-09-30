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

## Addendum: admin plugin and account-linking routes closed over HTTP (2026-09-30)
- Every admin plugin path, plus `/link-social`, `/unlink-account` and `/update-session`, is in `disabledPaths` and answers 404 over HTTP. Better Auth's other core routes stay open (sign-in and callback, `get-session`, sign-out, `/update-user` with the guards above, session listing and revoking, and so on); those that need email/password or account deletion are refused by configuration. The admin paths come from the plugin's own endpoints, so a Better Auth upgrade that adds one is closed too, and a test fails if one is open.
- Admin actions happen only through the app's server functions (`src/server/admin-users.ts`), which call `auth.api.banUser`, `unbanUser` and `setRole` server-side (`disabledPaths` applies only to the HTTP router). Those enforce the app's rules (ADR 6: admins can't be banned, env admins and the last admin can't be demoted, no self-demotion) and write the audit log, which the plugin's own routes skip. The browser client no longer includes the admin plugin.
