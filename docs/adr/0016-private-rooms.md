# 16. Private rooms: invite link plus host approval

Date: 2026-09-27 · Status: accepted

## Decision
- Private rooms are hidden from Live Now, search and profile "recent streams" for anyone who isn't a member. Admins still see them.
- The invite URL carries an unguessable token. Opening it lets a signed-in user **knock**. The host or a mod approves or denies each knock over the WebSocket. Only approved users receive signalling for the room.
- The host can regenerate the invite token, which invalidates old links. Knocks pending through an old link end at once, refused as invalid.
- Once approved, a user can rejoin freely until the room ends, unless kicked.

## Consequences
- Knock requests need UI for approvers (a toast or a people-tab queue) and a waiting state for the knocker. Neither is in the design yet.
- If no host or mod is present to approve, knockers wait. Combined with ADR 14, an empty private room can only be revived by someone already approved.

## Addendum: profiles and search count public rooms only (2026-10-02)
Since stats include rooms in progress (ADR 11 addendum), a profile moved almost in real time while someone sat in a private room, and its co-users named who was in there with them. Profiles follow the same rule as the listings: private rooms stay out.

- **Public rooms only, for everyone but admins.** A profile's stats (hours streamed and watched, rooms hosted and joined, peak viewers) and its top co-users, and the hours on a search result, count only public rooms, live or rolled up. Admins see every room, as they do everywhere else (`userStatsVisibleTo`, `userCotimeVisibleTo` in `src/server/stats.ts`). The admin dashboard is admin-only and reads every room.
- **Not "rooms the viewer could see".** Letting a viewer's private rooms in would make a profile differ per viewer, and the stored aggregates can't be filtered per viewer: they don't record which rooms they came from. Public-only is one stored number per stat, and it can't leak a room the viewer isn't in. It's slightly less informative to members of a shared private room, which was judged fine.
- **Stored twice.** `user_stats` and `user_cotime` each gain `public_*` columns beside the all-rooms ones. The roll-up (the only write) adds a room to both, or to the all-rooms ones alone when the room is private (a room's privacy is fixed at creation). Reads add the rooms not yet rolled up, filtered to public ones for the public columns, so the equality of totals just before and after a roll-up holds for both. Peak viewers is a max, which is why the public figure can't be worked out as the total minus the private rooms.
- **Platform totals stay over every room.** The home "Community" totals and the admin all-time totals include private rooms: they name no room or user, and they're the same for every caller.
- **Backfill (migration 0005).** The new columns are filled from the rooms still in the database: public rooms already rolled up (ended within 30 days), with the roll-up's SQL as of that migration. Rooms the 30-day purge already deleted can't be told public from private (ADR 11), so their time is left out of the public columns and stays in the all-rooms ones. Public figures can therefore start lower than before for a platform that has already purged; nothing private is exposed. Rooms in progress need no backfill: they are read live.
