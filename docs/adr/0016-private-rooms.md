# 16. Private rooms: invite link plus host approval

Date: 2026-09-27 · Status: accepted

## Decision
- Private rooms are hidden from Live Now, search and profile "recent streams" for anyone who isn't a member. Admins still see them.
- The invite URL carries an unguessable token. Opening it lets a signed-in user **knock**. The host or a mod approves or denies each knock over the WebSocket. Only approved users receive signalling for the room.
- The host can regenerate the invite token, which invalidates old links.
- Once approved, a user can rejoin freely until the room ends, unless kicked.

## Consequences
- Knock requests need UI for approvers (a toast or a people-tab queue) and a waiting state for the knocker. Neither is in the design yet.
- If no host or mod is present to approve, knockers wait. Combined with ADR 14, an empty private room can only be revived by someone already approved.
