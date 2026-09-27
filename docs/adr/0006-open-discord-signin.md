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
