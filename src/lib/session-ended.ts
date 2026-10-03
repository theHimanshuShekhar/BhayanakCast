/**
 * What a page does when the server says its session ended (`session_ended`: signed out in another
 * tab, sessions revoked, the expired-session purge), wired by the app shell.
 *
 * - Not in a room, or only in its pre-join lobby: reload the session at once and drop the reads
 *   made as the old user. The room route's guard then sends a visitor on a room URL to sign in.
 * - In a room (this tab entered it): do nothing yet. The room page shows its own notice, which the
 *   guard would send it away from. Once the tab navigates off that room (home, or another room's
 *   page), drop the cached reads and restart the socket, so it carries whatever cookie the browser
 *   has now: anonymous after the sign-out, or the new session if the user signed in again in
 *   another tab (that gives the same user id, which `useLobbyLive` takes for no change). When the
 *   user is still signed out, `useLobbyLive` restarts it too (the id went to null): one extra
 *   reconnect, left alone.
 * The trigger is `isSignedOutError`: `session_ended`, or an anonymous `room.join` refusal.
 */
import { isSignedOutError } from "./realtime";
import type { RealtimeClient } from "./realtime-client";

export interface SessionEndedDeps {
  client: Pick<RealtimeClient, "subscribe" | "restart">;
  /** The current URL path. */
  pathname(): string;
  /** This tab entered `roomId` (past the pre-join lobby). */
  inRoom(roomId: string): boolean;
  /** Calls `listener` whenever a navigation finishes; returns its unsubscribe. */
  onNavigated(listener: () => void): () => void;
  /** Drop what was cached as the old user, and refetch what is shown. */
  dropCachedReads(): void;
  /** Reload the session into router context. */
  reloadSession(): void;
}

const roomIdOf = (pathname: string) => /^\/room\/([^/]+)/.exec(pathname)?.[1];

export function followSessionEnded(deps: SessionEndedDeps): () => void {
  /** The room whose page is showing the notice; any navigation to another page ends it. */
  let pendingRoom: string | null = null;
  const unsubscribe = deps.client.subscribe((message) => {
    // `session_ended`, or the refusal that says the same to a page that missed it.
    if (message.type !== "error" || !isSignedOutError(message)) return;
    const roomId = roomIdOf(deps.pathname());
    if (roomId && deps.inRoom(roomId)) {
      pendingRoom = roomId;
      return;
    }
    deps.dropCachedReads();
    deps.reloadSession();
  });
  const unsubscribeNavigated = deps.onNavigated(() => {
    // Another room's page counts as leaving this one: its own join needs the right cookie.
    if (pendingRoom === null || roomIdOf(deps.pathname()) === pendingRoom) return;
    pendingRoom = null;
    deps.dropCachedReads();
    deps.client.restart();
  });
  return () => {
    unsubscribe();
    unsubscribeNavigated();
  };
}
