/**
 * Room changes made outside the realtime server (a room created through a server function, a thumbnail uploaded through its route)
 * that it must hear about to tell the lobby (ADR 20). `createRoom` and the thumbnail upload announce; the realtime
 * endpoint (./realtime.ts) listens and hands them to its hub.
 *
 * The listeners live on a process global, not in a module variable: the SSR bundle (where
 * server functions run) and the realtime endpoint each load their own copy of this module,
 * in production (server.prod.ts) and in dev (Vite's SSR module graph) alike.
 */

export type RoomAnnouncement =
  | {
      kind: "created";
      roomId: string;
      name: string;
      /** The creator, who is its host (until someone else has been in it without them, ADR 14). */
      hostUserId: string;
      isPrivate: boolean;
    }
  /** A streamer uploaded a new thumbnail, so the room's cards are stale (ADR 10). */
  | { kind: "thumbnail"; roomId: string };

type Listener = (announcement: RoomAnnouncement) => void;

const LISTENERS = Symbol.for("bhayanakcast.roomAnnouncementListeners");
const registry = globalThis as { [LISTENERS]?: Set<Listener> };

function listeners(): Set<Listener> {
  registry[LISTENERS] ??= new Set();
  return registry[LISTENERS];
}

/** Tell every listener in the process. A failing listener never fails the caller. */
export function announceRoom(announcement: RoomAnnouncement): void {
  for (const listener of listeners()) {
    try {
      listener(announcement);
    } catch (error) {
      console.error("[realtime] a room announcement listener failed", error);
    }
  }
}

/** Hear every announcement until the returned function is called. */
export function onRoomAnnouncement(listener: Listener): () => void {
  listeners().add(listener);
  return () => listeners().delete(listener);
}
