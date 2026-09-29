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
