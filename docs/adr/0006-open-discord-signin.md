# 6. Open sign-in for any Discord user

Date: 2026-09-27 · Status: accepted

## Decision
Anyone with a Discord account can sign in through Discord OAuth. There is no guild-membership gate and no invite list. Discord is the only identity provider.

## Consequences
- The app is effectively public, so it needs basic abuse controls: rate limits on room creation, chat and signalling messages; server-side validation of all WebSocket messages; the ability for admins to ban users and end rooms; and host/mod kick from a room.
- Private rooms (invite link) are the way to keep a hangout to friends.
- The admin role is granted explicitly (DB flag or configured Discord user IDs), never inferred.

## Addendum: admin role
The `ADMIN_DISCORD_IDS` env var (comma-separated Discord user IDs) grants the admin role at sign-in. Admins can promote or demote other admins from `/admin`. The role is stored in the DB through the Better Auth admin plugin. Env-listed admins can't be demoted from the UI.

## Addendum: BhayanakBot
There is no BhayanakBot integration for now. Room-live announcements or slash commands may be added later as a separate decision.

## Addendum: visitors and the sign-in entry point (2026-09-27)
- Visitors can view home, profiles and past-stream recaps. Entering a room requires sign-in. Private rooms are never shown to visitors, and `/admin` requires the admin role.
- There is no sign-in page. A "sign in with Discord" button (in the rail's avatar slot, in the home sidebar, and in a "sign in to join" prompt when a visitor clicks a room) goes straight to Discord OAuth and returns to home. Signing out also returns to the public home.
- Hosts: `https://cast.bhayanak.net` (production) and `http://localhost:3000` (development). Both are registered as Discord redirect URIs.
- Admin actions in v1: ban and unban users (which also removes them from live rooms), end any room, promote and demote admins, and a TURN relayed-bandwidth panel against the Cloudflare free tier.

## Addendum: bans and the admin audit log (2026-09-29)
- A ban goes through the Better Auth admin plugin (reason, expiry of 1 day, 7 days or none), which revokes the user's sessions. The realtime server then tells each of their sockets `banned`, closes them, and removes them from any live room, which sees them leave. Admins can't be banned: demote them first.
- Every admin action writes a row to `admin_actions` (actor, action, target user or room, details, time). Unbanning someone with no ban in force changes and logs nothing.
- The audit log is kept indefinitely (ADR 11 addendum). It has no foreign keys to `rooms` or `user`, so neither the 30-day room purge nor a deleted account removes its rows.
