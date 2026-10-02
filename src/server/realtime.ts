/**
 * The realtime WebSocket endpoint (ADR 4 + addenda) on the app's Node HTTP server, so it runs
 * in the same process as SSR. A thin adapter: it authenticates the upgrade with the session
 * cookie (ADR 7), then hands frames and closes to the room hub (./room-hub.ts), which owns all
 * live state and the protocol (src/lib/realtime.ts). An upgrade without a valid session opens
 * an anonymous, lobby-only socket (ADR 20), at most `anonymousSocketsPerIp` per client IP
 * (`cf-connecting-ip` only from a trusted proxy, ./client-ip.ts). A signed-in user may hold at
 * most `socketsPerUser` sockets (tabs and devices); more are refused with 429, like visitors'.
 * A socket that stops reading is dropped once `MAX_BUFFERED_BYTES` are waiting to be sent to it.
 *
 * `ws` runs in no-server mode on the server's `upgrade` event and only takes upgrades on
 * `REALTIME_PATH`, leaving any others (Vite's HMR socket in dev) to their own listeners.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { getDb } from "../db/client.ts";
import { MAX_BUFFERED_BYTES, MAX_CLIENT_MESSAGE_BYTES, REALTIME_PATH } from "../lib/realtime.ts";
import type { Caller } from "./caller.ts";
import { CLIENT_IP_HEADER, createClientIpResolver } from "./client-ip.ts";
import { systemClock } from "./clock.ts";
import { env } from "./env.ts";
import { registerLiveHub } from "./live-hub.ts";
import { onRoomAnnouncement } from "./room-announcements.ts";
import { type Connection, RoomHub } from "./room-hub.ts";
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
  /**
   * Open anonymous sockets allowed per client IP (ADR 20); more are refused with 429.
   * Defaults to `REALTIME_ANONYMOUS_SOCKETS_PER_IP`.
   */
  anonymousSocketsPerIp?: number;
  /**
   * Open sockets (and upgrades in progress) allowed per signed-in user; more are refused with
   * 429. Defaults to `REALTIME_SOCKETS_PER_USER`.
   */
  socketsPerUser?: number;
  /**
   * Peers whose `cf-connecting-ip` names the client (./client-ip.ts); for anyone else the socket
   * address is the client IP. Defaults to `TRUSTED_PROXY_IPS`.
   */
  trustedProxies?: readonly string[];
  /**
   * Bytes allowed unsent to one socket before it is dropped (it has stopped reading).
   * Defaults to `MAX_BUFFERED_BYTES`.
   */
  maxBufferedBytes?: number;
  /**
   * Refuse upgrades on any path but `REALTIME_PATH` (404) instead of leaving them to other
   * `upgrade` listeners. Set it where nothing else takes upgrades (production), or they hang
   * open forever; leave it off in dev, where Vite's HMR socket upgrades on the same server.
   */
  closeUnknownUpgrades?: boolean;
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
  const hub =
    options.hub ??
    new RoomHub({
      clock: systemClock,
      store: createDbRoomStore(getDb()),
      emptyRoomTimeoutMs: env.REALTIME_EMPTY_ROOM_TIMEOUT_MS,
    });
  const authenticate = options.authenticate ?? authenticateFromSession;
  const anonymousLimit = options.anonymousSocketsPerIp ?? env.REALTIME_ANONYMOUS_SOCKETS_PER_IP;
  const userLimit = options.socketsPerUser ?? env.REALTIME_SOCKETS_PER_USER;
  const maxBufferedBytes = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
  const clientIp = createClientIpResolver(options.trustedProxies ?? env.TRUSTED_PROXY_IPS, {
    warn: (message) => console.warn(`[realtime] ${message}`),
  });
  /** Open anonymous sockets (and upgrades in progress) by client IP. */
  const anonymousByIp = new Map<string, number>();
  /** Open signed-in sockets (and upgrades in progress) by user id. */
  const socketsByUser = new Map<string, number>();
  const stopAnnouncements = onRoomAnnouncement((announcement) => {
    void hub.announce(announcement);
  });
  // Admin server functions reach it here (a ban disconnects the user; a role change updates them).
  const unregisterHub = registerLiveHub(hub);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });

  function serve(ws: WebSocket, caller: Caller): void {
    // Listeners first, so a close is never missed (`terminate` after a later throw fires it);
    // `connection` is set once the hub has registered the socket.
    let connection: Connection | undefined;
    ws.on("close", () => {
      if (connection) void hub.disconnect(connection);
    });
    ws.on("error", (error) => console.error("[realtime] socket error", error));
    const registered = hub.connect(
      {
        send: (message) => {
          if (ws.readyState !== ws.OPEN) return;
          if (ws.bufferedAmount > maxBufferedBytes) return dropSlowClient(ws, caller);
          ws.send(JSON.stringify(message));
        },
        close: (code, reason) => ws.close(code, reason),
      },
      caller,
    );
    connection = registered;
    ws.on("message", (data, isBinary) => {
      void hub.handle(registered, isBinary ? null : data.toString());
    });
  }

  /**
   * `ws` isn't being read: terminate it rather than close it, since a close frame would queue
   * behind the backlog and never arrive (and the handshake would hold the socket, and its
   * buffer, for `ws`'s close timeout). `close` fires as for any drop and tells the hub.
   */
  function dropSlowClient(ws: WebSocket, caller: Caller): void {
    console.warn(
      `[realtime] dropping ${caller.user ? `user ${caller.user.id}` : "an anonymous socket"}: ` +
        `${ws.bufferedAmount} bytes unsent (limit ${maxBufferedBytes})`,
    );
    ws.terminate();
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
    // The client left while we were authenticating: `close` has already fired, so a count
    // taken now would never be released.
    if (socket.destroyed) return;
    // Held until the TCP socket closes, whether the handshake completes or not.
    if (caller.user) {
      if (!takeSlot(socketsByUser, caller.user.id, userLimit, socket)) {
        return refuse(socket, 429, "Too Many Requests");
      }
    } else {
      const ip = clientIp(request.socket.remoteAddress, request.headers[CLIENT_IP_HEADER]);
      if (!takeSlot(anonymousByIp, ip, anonymousLimit, socket)) {
        return refuse(socket, 429, "Too Many Requests");
      }
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      // The 101 is already written, so a throw here can't be answered with an HTTP status
      // (`failUpgrade` would write it into the WebSocket stream): drop the socket instead.
      try {
        serve(ws, caller);
      } catch (error) {
        console.error("[realtime] serving a new socket failed", error);
        ws.terminate();
      }
    });
  }

  /** Log an unexpected throw from the upgrade path and drop the request; the server keeps going. */
  function failUpgrade(socket: Duplex, error: unknown): void {
    console.error("[realtime] handling an upgrade failed", error);
    if (socket.writable) refuse(socket, 500, "Internal Server Error");
    else socket.destroy();
  }

  function route(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    let pathname: string;
    try {
      ({ pathname } = new URL(request.url ?? "/", "http://localhost"));
    } catch {
      refuse(socket, 400, "Bad Request");
      return;
    }
    if (pathname === REALTIME_PATH) {
      upgrade(request, socket, head).catch((error) => failUpgrade(socket, error));
    } else if (options.closeUnknownUpgrades) {
      refuse(socket, 404, "Not Found");
    }
  }

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Runs synchronously in the server's `upgrade` listener, and `upgrade` is async: anything
    // thrown or rejected here would be uncaught and take the whole process down.
    try {
      route(request, socket, head);
    } catch (error) {
      failUpgrade(socket, error);
    }
  };
  server.on("upgrade", onUpgrade);

  return {
    hub,
    get openSockets() {
      return wss.clients.size;
    },
    async close() {
      server.off("upgrade", onUpgrade);
      stopAnnouncements();
      unregisterHub();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await hub.idle();
    },
  };
}

/**
 * Count one more open socket for `key` in `open`, released when `socket` closes. False, with
 * nothing counted, if `key` already has `limit`.
 */
function takeSlot(open: Map<string, number>, key: string, limit: number, socket: Duplex): boolean {
  const held = open.get(key) ?? 0;
  if (held >= limit) return false;
  open.set(key, held + 1);
  socket.once("close", () => {
    const left = (open.get(key) ?? 1) - 1;
    if (left > 0) open.set(key, left);
    else open.delete(key);
  });
  return true;
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
  socket.on("error", () => socket.destroy());
  socket.once("finish", () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
