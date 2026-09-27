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
