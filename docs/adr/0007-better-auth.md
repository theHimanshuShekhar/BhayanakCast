# 7. Better Auth for Discord OAuth and sessions

Date: 2026-09-27 · Status: accepted

## Decision
Use Better Auth with the Discord social provider, the Drizzle adapter (Postgres), and database-backed sessions in an httpOnly cookie. Use its admin plugin (roles, ban) and built-in rate limiting (ADR 6). The WebSocket upgrade authenticates by validating the same session cookie. Unauthenticated upgrades are rejected.

## Consequences
- Auth tables are owned by Better Auth's schema and generated into the Drizzle schema.
- The Discord username/avatar are stored at sign-in; the profile's "discord" field comes from there.

> Amended by ADR 20: unauthenticated upgrades are accepted into a read-only lobby channel only.
