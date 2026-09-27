/**
 * The realtime WebSocket endpoint (ADR 4 + addenda) on the app's Node HTTP server, so it runs
 * in the same process as SSR. A thin adapter: it authenticates the upgrade with the session
 * cookie (ADR 7), then hands frames and closes to the room hub (./room-hub.ts), which owns all
 * live state and the protocol (src/lib/realtime.ts).
 *
 * `ws` runs in no-server mode on the server's `upgrade` event and only takes upgrades on
 * `REALTIME_PATH`, leaving any others (Vite's HMR socket in dev) to their own listeners.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { getDb } from "../db/client.ts";
import { MAX_CLIENT_MESSAGE_BYTES, REALTIME_PATH } from "../lib/realtime.ts";
import type { Caller } from "./caller.ts";
import { systemClock } from "./clock.ts";
import { RoomHub } from "./room-hub.ts";
import { createDbRoomStore } from "./room-store.ts";
import { callerFromSession, getSessionFromRequest } from "./session.ts";

export interface RealtimeOptions {
  /** Defaults to a hub on the system clock and the process database. */
  hub?: RoomHub;
  /**
   * Who is opening the socket, from the upgrade request. Defaults to the Better Auth session
   * cookie (banned users count as signed out).
   */
  authenticate?: (request: IncomingMessage) => Promise<Caller>;
}

export interface RealtimeServer {
  hub: RoomHub;
  /** Sockets open right now (server side). */
  readonly openSockets: number;
  /** Stop taking upgrades and close every open socket. */
  close(): Promise<void>;
}

const authenticateFromSession = async (request: IncomingMessage): Promise<Caller> =>
  callerFromSession(await getSessionFromRequest(request));

export function attachRealtime(server: Server, options: RealtimeOptions = {}): RealtimeServer {
  const hub = options.hub ?? new RoomHub({ clock: systemClock, store: createDbRoomStore(getDb()) });
  const authenticate = options.authenticate ?? authenticateFromSession;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });

  function serve(ws: WebSocket, caller: Caller): void {
    const connection = hub.connect(
      {
        send: (message) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
        },
        close: (code, reason) => ws.close(code, reason),
      },
      caller,
    );
    ws.on("message", (data, isBinary) => {
      void hub.handle(connection, isBinary ? null : data.toString());
    });
    ws.on("close", () => {
      void hub.disconnect(connection);
    });
    ws.on("error", (error) => console.error("[realtime] socket error", error));
  }

  async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    socket.on("error", () => socket.destroy());
    if (!isSameOrigin(request)) return refuse(socket, 403, "Forbidden");
    let caller: Caller;
    try {
      caller = await authenticate(request);
    } catch (error) {
      console.error("[realtime] authenticating an upgrade failed", error);
      return refuse(socket, 500, "Internal Server Error");
    }
    // Signed-in sockets only until the anonymous lobby channel lands (ADR 20, #24).
    if (!caller.user) return refuse(socket, 401, "Unauthorized");
    wss.handleUpgrade(request, socket, head, (ws) => serve(ws, caller));
  }

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname !== REALTIME_PATH) return;
    void upgrade(request, socket, head);
  };
  server.on("upgrade", onUpgrade);

  return {
    hub,
    get openSockets() {
      return wss.clients.size;
    },
    async close() {
      server.off("upgrade", onUpgrade);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await hub.idle();
    },
  };
}

/**
 * Browsers always send `Origin` on a WebSocket upgrade, and cookies ride along cross-site, so
 * refuse other origins (cross-site WebSocket hijacking). Non-browser clients send none.
 */
function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.once("finish", () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
