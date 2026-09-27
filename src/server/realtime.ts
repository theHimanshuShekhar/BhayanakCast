import type { Server } from "node:http";

/**
 * Attach the realtime WebSocket endpoint (signalling, presence, chat) to the
 * app's Node HTTP server, so it runs in the same process as SSR.
 *
 * TODO(ADR 0004): implement the WebSocket server here — handle `upgrade` on
 * `server`, route room signalling/presence/chat, keep the last 50 chat
 * messages per room in memory. Presence events are the source of truth per ADR 0012.
 */
export function attachRealtime(_server: Server): void {
  // No-op until ADR 0004 is implemented.
}
