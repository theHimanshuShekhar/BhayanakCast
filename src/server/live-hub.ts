/**
 * The process's running realtime hub, for server functions that change live state: an admin
 * ban disconnects the user, a role change updates their open sockets, ending a room sends its
 * people home (ADR 6). The realtime endpoint (./realtime.ts) registers its hub.
 *
 * Like ./room-announcements.ts, it lives on a process global, not in a module variable: the
 * SSR bundle (where server functions run) and the realtime endpoint each load their own copy
 * of this module, in production (server.prod.ts) and in dev (Vite's SSR module graph) alike.
 */
import type { RoomHub } from "./room-hub.ts";

const HUB = Symbol.for("bhayanakcast.liveHub");
const registry = globalThis as { [HUB]?: RoomHub };

/** Make `hub` the live one until the returned function is called. */
export function registerLiveHub(hub: RoomHub): () => void {
  registry[HUB] = hub;
  return () => {
    if (registry[HUB] === hub) delete registry[HUB];
  };
}

/** The live hub, or null while no realtime endpoint is attached in this process. */
export function getLiveHub(): RoomHub | null {
  return registry[HUB] ?? null;
}
