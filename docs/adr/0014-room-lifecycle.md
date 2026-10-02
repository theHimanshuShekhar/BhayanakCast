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

## Addendum: rooms an admin ends (2026-09-29)
- An admin can end any live room at once (ADR 6 addendum). Such a room doesn't wait out the empty-room timer: its end time is **when the admin ended it** (`endedAt = now`), not when it last became empty. Everyone in it is sent home, their intervals close at that time (or when their socket closed, for anyone in their reconnect grace), and it becomes a past stream with its stats rolled up as for any ended room.

## Addendum: navigating away asks first (2026-10-02)
- While a tab is **joined** to a room (the server's snapshot has arrived, and it hasn't been kicked, taken over or sent home), leaving the page asks first. Links and the browser's back and forward get an in-app "Leave the room?" dialog (Stay or Leave; Escape is Stay), built on TanStack Router's `useBlocker` with a resolver (`src/components/room/leave-guard.tsx`). Leave does what the leave button does (forget the room for reloads, then let the navigation go; the room page unmounting sends `room.leave` and stops the mic and camera). Closing or reloading the tab gets the browser's own `beforeunload` prompt, which the same blocker registers (a page can't customise it).
- The pre-join lobby, the knock screen and the "room full" wait are not joined, so they never ask. The leave button, the room ending, and the removal and takeover notices are not questioned either: the first two navigate with `ignoreBlocker`, and the guard is not mounted once the page is out of the room. A ban loads home afresh as a visitor, so it marks it first (`markLeavingForBan`) to keep the browser prompt away.
- **A reload now shows the browser's prompt**, because the browser can't tell a reload from closing the tab. Confirming it is still a reconnect, not a leave and a join (see above): the page rejoins within the grace without the lobby. The e2e fixtures accept `beforeunload` prompts on every page.
- Signing out from inside a room also skips the question (its navigation home passes `ignoreBlocker`): the session is already gone by then.
