/**
 * The realtime WebSocket endpoint (ADR 4 + addenda) on the app's Node HTTP server, so it runs
 * in the same process as SSR. A thin adapter: it authenticates the upgrade with the session
 * cookie (ADR 7), then hands frames and closes to the room hub (./room-hub.ts), which owns all
 * live state and the protocol (src/lib/realtime.ts). An upgrade without a valid session opens
 * an anonymous, lobby-only socket (ADR 20), at most `anonymousSocketsPerIp` per client IP
 * (`cf-connecting-ip` only from a trusted proxy, ./client-ip.ts). A signed-in user may hold at
 * most `socketsPerUser` sockets (tabs and devices); more are refused with 429, like visitors'.
 * A socket that stops reading is dropped once `MAX_BUFFERED_BYTES` are waiting to be sent to it.
 * The hub is told which session each socket was opened with and closes them when it ends.
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
import { logUntrustedProxy, withSlowWriteLog } from "./log-events.ts";
import { log } from "./logger.ts";
import { onRoomAnnouncement } from "./room-announcements.ts";
import { type Connection, RoomHub } from "./room-hub.ts";
import { createDbRoomStore } from "./room-store.ts";
import { createTimelineRecorder } from "./room-timeline.ts";
import { type Authenticated, authenticatedFromSession, getSessionFromRequest } from "./session.ts";

export interface RealtimeOptions {
  /** Defaults to a hub on the system clock and the process database. */
  hub?: RoomHub;
  /**
   * Who is opening the socket, and with which session, from the upgrade request. Defaults to the
   * Better Auth session cookie (banned users count as signed out). A session that later ends
   * closes its sockets (`RoomHub.sessionEnded`, from Better Auth's session-delete hook).
   */
  authenticate?: (request: IncomingMessage) => Promise<Authenticated>;
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
  /** Stop taking upgrades, close every open socket and stop the hub's retries (`RoomHub.stop`). */
  close(): Promise<void>;
}

/** The `RoomStore` methods that only read; every other one writes, so is timed (`db.slow_write`). */
const STORE_READS: ReadonlySet<string> = new Set([
  "findRoomFor",
  "loadLiveRooms",
  "isKicked",
  "findInvitedRoom",
]);
const isStoreWrite = (name: string) => !STORE_READS.has(name);

const authenticateFromSession = async (request: IncomingMessage): Promise<Authenticated> =>
  authenticatedFromSession(await getSessionFromRequest(request));

export function attachRealtime(server: Server, options: RealtimeOptions = {}): RealtimeServer {
  // A hub made here records its room timeline here: written out on `close`. A hub passed in
  // brings its own timeline, which is its owner's to close.
  const timeline = options.hub ? undefined : createTimelineRecorder(getDb(), systemClock);
  const hub =
    options.hub ??
    new RoomHub({
      clock: systemClock,
      store: withSlowWriteLog(createDbRoomStore(getDb()), isStoreWrite),
      timeline,
      emptyRoomTimeoutMs: env.REALTIME_EMPTY_ROOM_TIMEOUT_MS,
    });
  const authenticate = options.authenticate ?? authenticateFromSession;
  const anonymousLimit = options.anonymousSocketsPerIp ?? env.REALTIME_ANONYMOUS_SOCKETS_PER_IP;
  const userLimit = options.socketsPerUser ?? env.REALTIME_SOCKETS_PER_USER;
  const maxBufferedBytes = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
  const clientIp = createClientIpResolver(options.trustedProxies ?? env.TRUSTED_PROXY_IPS, {
    warn: logUntrustedProxy,
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

  function serve(ws: WebSocket, { caller, sessionId }: Authenticated): void {
    // Listeners first, so a close is never missed (`terminate` after a later throw fires it);
    // `connection` is set once the hub has registered the socket.
    let connection: Connection | undefined;
    const openedAt = Date.now();
    const userId = caller.user?.id;
    ws.on("close", (code) => {
      if (connection) {
        void hub.disconnect(connection);
        // The close reason is the peer's own text, so it isn't logged.
        log.info("socket.close", "socket closed", {
          userId,
          socketId: connection.id,
          code,
          openMs: Date.now() - openedAt,
        });
      }
    });
    // A peer's protocol violation (an oversized or malformed frame): the socket is dropped.
    ws.on("error", (error) =>
      log.warn("socket.error", "socket error", { userId, socketId: connection?.id, err: error }),
    );
    const registered = hub.connect(
      {
        send: (message) => {
          if (ws.readyState !== ws.OPEN) return;
          if (ws.bufferedAmount > maxBufferedBytes) {
            if (connection) hub.slowClientDropped(connection, ws.bufferedAmount);
            return dropSlowClient(ws, caller);
          }
          ws.send(JSON.stringify(message));
        },
        close: (code, reason) => ws.close(code, reason),
      },
      caller,
      sessionId,
    );
    connection = registered;
    log.info("socket.open", "socket opened", {
      userId,
      socketId: registered.id,
      ...(userId ? {} : { anonymous: true }),
    });
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
    log.warn("socket.slow_client_dropped", "dropping a socket that stopped reading", {
      userId: caller.user?.id,
      bufferedBytes: ws.bufferedAmount,
      limitBytes: maxBufferedBytes,
    });
    ws.terminate();
  }

  async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    socket.on("error", () => socket.destroy());
    if (!isSameOrigin(request)) {
      // Not the Origin itself: it can be an address, and it is the other site's to name.
      log.warn("socket.upgrade_refused", "refused a socket upgrade from another origin", {
        status: 403,
        reason: "wrong_origin",
      });
      return refuse(socket, 403, "Forbidden");
    }
    let authenticated: Authenticated;
    try {
      authenticated = await authenticate(request);
    } catch (error) {
      log.error("socket.upgrade_failed", "authenticating an upgrade failed", { err: error });
      return refuse(socket, 500, "Internal Server Error");
    }
    // The client left while we were authenticating: `close` has already fired, so a count
    // taken now would never be released.
    if (socket.destroyed) return;
    const { caller } = authenticated;
    // Held until the TCP socket closes, whether the handshake completes or not.
    if (caller.user) {
      if (!takeSlot(socketsByUser, caller.user.id, userLimit, socket)) {
        log.warn(
          "socket.upgrade_refused",
          "refused a socket upgrade: too many sockets for a user",
          {
            status: 429,
            reason: "too_many_sockets",
            userId: caller.user.id,
            limit: userLimit,
          },
        );
        return refuse(socket, 429, "Too Many Requests");
      }
    } else {
      const ip = clientIp(request.socket.remoteAddress, request.headers[CLIENT_IP_HEADER]);
      if (!takeSlot(anonymousByIp, ip, anonymousLimit, socket)) {
        // The address only keys the sampling here (the logger never writes it).
        log.warn(
          "socket.upgrade_refused",
          "refused a socket upgrade: too many signed-out sockets from one address",
          {
            status: 429,
            reason: "too_many_anonymous_sockets",
            limit: anonymousLimit,
            sampleKey: ip,
          },
        );
        return refuse(socket, 429, "Too Many Requests");
      }
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      // The 101 is already written, so a throw here can't be answered with an HTTP status
      // (`failUpgrade` would write it into the WebSocket stream): drop the socket instead.
      try {
        serve(ws, authenticated);
      } catch (error) {
        log.error("socket.serve_failed", "serving a new socket failed", {
          userId: authenticated.caller.user?.id,
          err: error,
        });
        ws.terminate();
      }
    });
  }

  /** Log an unexpected throw from the upgrade path and drop the request; the server keeps going. */
  function failUpgrade(socket: Duplex, error: unknown): void {
    log.error("socket.upgrade_failed", "handling an upgrade failed", { err: error });
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
      // No retrying restart recovery or room ends from here: the database pool closes next.
      hub.stop();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await hub.idle();
      // Its last events, before the pool closes (it gives up if the database is stuck).
      await timeline?.close();
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
