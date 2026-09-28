# 14. Room lifecycle

Date: 2026-09-27 · Status: accepted

## Decision
- A room stays live while it is occupied. When it becomes empty, a **5-minute** timer starts.
- If anyone joins during those 5 minutes, the room continues. If it was empty, **the joiner becomes the new host**.
- If nobody joins within 5 minutes, the room **ends**. Its end time is when it last became empty, and it becomes a past stream (subject to the 30-day retention in ADR 11).

## Consequences
- An empty room is not listed under "Live Now", or is shown as idle; that is a UI detail.
- The server owns the timer. A server restart during the idle window ends the room at its last-empty time.
- If the host leaves while others remain, whether by explicit leave or disconnect, there is a **30-second host grace period**. The host badge shows "reconnecting…" and mods keep their powers. If the host returns within 30s, they keep host. Otherwise host passes to the **longest-present member**, with mods preferred. The original host does not reclaim host if they return later.
- **Never-occupied rooms (2026-09-28):** a new room starts with its creator as host, and the empty-room timer runs from creation. If someone else enters before the creator (who may still be in the pre-join lobby), the creator keeps host under the normal 30s host grace, and host hands over only if they don't arrive. A room nobody ever enters ends at its creation time.
