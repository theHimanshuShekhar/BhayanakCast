# 15. Room roles and moderation powers

Date: 2026-09-27 · Status: accepted

## Decision
| Action | Host | Mod | Admin (any room) |
|---|---|---|---|
| Kick (can't rejoin that room) | ✓ | ✓ | ✓ |
| Force-stop a screen share | ✓ | ✓ | ✓ |
| Promote/demote mod | ✓ | | ✓ |
| Rename room | ✓ | | ✓ |
| Site-wide ban | | | ✓ |

All moderation actions are WebSocket commands, authorised on the server against the sender's current role.

## Consequences
- A kicked peer's peer connections are torn down by every other client when the server broadcasts the kick. The server also refuses to relay signalling to or from them for that room.
- A force-stopped share must be enforced client-side by the other peers ignoring that track, because the server can't touch P2P media.
- An admin can't be moderated by a host or mod even while they have no socket: someone in their reconnect grace, or restored after a server restart (ADR 4 addendum), is still an admin. The hub reads the role from the person's connection, which a role change updates even when it is closed (`setUserRole`), and restart recovery loads it from the user row (`OpenPresence.role`). Before, such an admin was treated as a regular user, so a host or mod could kick them or change their role.
