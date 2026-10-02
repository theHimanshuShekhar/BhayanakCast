/**
 * Protocol-seam test harness for the realtime server (spec #3). It runs the real endpoint
 * (`attachRealtime`) in-process on an ephemeral port, over a fresh migrated PGlite, with a
 * `FakeClock` driving the hub, and connects real `ws` clients authenticated by real Better Auth
 * session cookies (from the test-only sign-in). Tests assert protocol messages and DB rows only.
 *
 *   const h = await startRealtimeHarness();            // afterEach: await h.close()
 *   const ana = await h.createUser("ana");
 *   const roomId = await h.createRoom(ana);
 *   const a = await h.connectAs(ana);                   // open + hello/welcome done
 *   const snapshot = await a.join(roomId);              // room.join → room.snapshot
 *   const joined = await a.waitForEvent("joined");      // someone else joined
 *   await h.advance(30_000);                            // fire due hub timers, then settle
 *   await h.settled();                                  // closes seen by server + hub idle
 *   await h.restart();                                  // crash + new hub on the same DB
 *
 * Like the browser client, every welcomed client heartbeats: `advance` moves the clock in
 * steps of at most `PING_INTERVAL_MS` and has each one `ping` (and swallows the `pong`) before
 * every step, so long advances don't trip the server's idle timeout. Pass
 * `{ heartbeat: false }` to `connectAs` for a client that stays silent (and sees its pongs).
 *
 * Messages are consumed in order per type: `waitFor(type)` returns the oldest unconsumed
 * message of that type, waiting up to `timeoutMs` for one. `pending()` lists what's unconsumed,
 * so `expect(client.pending()).toEqual([])` after `settled()` asserts nothing else arrived
 * (lobby traffic and feed entries aside: see `pendingLobby()` and `pendingFeed()`).
 */
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { Db } from "../db/client.ts";
import { createTestDb } from "../db/test-db.ts";
import { createAuth } from "../lib/auth.ts";
import {
  type ClientMessage,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  parseServerMessage,
  REALTIME_PATH,
  type RoomEvent,
  type ServerMessage,
  type ServerMessageOf,
  type ServerMessageType,
} from "../lib/realtime.ts";
import type { CreateRoomInput } from "../lib/rooms.ts";
import { type Clock, FakeClock } from "./clock.ts";
import { attachRealtime, type RealtimeServer } from "./realtime.ts";
import { RoomHub } from "./room-hub.ts";
import { createDbRoomStore, type RoomStore } from "./room-store.ts";
import { createRoom } from "./rooms.ts";
import { callerFromSession, resolveSession, toHeaders } from "./session.ts";

// Real time, not the fake clock's: how long a wait for a message (or for the server to see a
// close) lasts before the test fails. Only a failing test ever waits it out, so it's generous: a
// loaded machine delays real sockets and PGlite by seconds. Keep it under `testTimeout` in
// vitest.config.ts, so a stuck wait reports what it waited for instead of a bare test timeout.
const DEFAULT_TIMEOUT_MS = 10_000;

const testEnv = {
  NODE_ENV: "test" as const,
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
};

export interface TestUser {
  id: string;
  username: string;
  discordId: string;
  /** A `Cookie` header value carrying the user's session. */
  cookie: string;
}

export type RoomEventMessage<K extends RoomEvent["kind"] = RoomEvent["kind"]> =
  ServerMessageOf<"room.event"> & { event: Extract<RoomEvent, { kind: K }> };

export interface TestClient {
  readonly user: TestUser | null;
  /** Every message received so far, consumed or not, in order. */
  readonly received: readonly ServerMessage[];
  send(message: ClientMessage): void;
  /** Send an arbitrary frame (for invalid-input tests). */
  sendRaw(data: string | Buffer): void;
  /** The oldest unconsumed message of `type` (matching `match`), waiting for it if needed. */
  waitFor<T extends ServerMessageType>(
    type: T,
    match?: (message: ServerMessageOf<T>) => boolean,
    timeoutMs?: number,
  ): Promise<ServerMessageOf<T>>;
  /** The oldest unconsumed `room.event` of `kind` (matching `match`). */
  waitForEvent<K extends RoomEvent["kind"]>(
    kind: K,
    match?: (message: RoomEventMessage<K>) => boolean,
    timeoutMs?: number,
  ): Promise<RoomEventMessage<K>>;
  /** Send `room.join` and wait for the room's snapshot. */
  join(roomId: string): Promise<ServerMessageOf<"room.snapshot">>;
  /**
   * Messages received but not yet consumed by a `waitFor`, apart from lobby traffic
   * (`lobby.*`), which every socket gets whenever anyone comes online or rooms change, and
   * `feed.entry`, which echoes every join, leave and reaction (see `pendingFeed()`).
   */
  pending(): ServerMessage[];
  /** Unconsumed `lobby.*` messages, in order. */
  pendingLobby(): ServerMessage[];
  /** Unconsumed `feed.entry` messages, in order. */
  pendingFeed(): ServerMessage[];
  readonly isClosed: boolean;
  /** Stop reading from the socket, like a frozen tab: the server's sends back up. */
  stopReading(): void;
  /** Read again after `stopReading`. */
  resumeReading(): void;
  /** Wait until the socket is closed (by either side); resolves with the close code. */
  closed(): Promise<number>;
  /** Close the socket and wait until it's closed. */
  close(): Promise<void>;
}

/** A client plus the harness's heartbeat hook. */
interface HarnessClient extends TestClient {
  /** If this client heartbeats and is welcomed and open: ping and wait for the pong. */
  beat(): Promise<void>;
}

export interface ConnectOptions {
  /** Ping during `advance` like the browser client does (default true). */
  heartbeat?: boolean;
}

export interface RealtimeHarness {
  db: Db;
  clock: FakeClock;
  /** The current hub (a new one after `restart`). */
  readonly hub: RoomHub;
  /** `ws://127.0.0.1:<port>/ws` */
  url: string;
  /** A signed-in user with a real session, via the test-only sign-in. */
  createUser(username: string, options?: { admin?: boolean; image?: string }): Promise<TestUser>;
  /** A live public room hosted by `host` (through `createRoom`, like the create dialog). */
  createRoom(host: TestUser, input?: Partial<CreateRoomInput>): Promise<string>;
  /** Open a socket as `user` (null: no cookie) without the handshake. Rejects if refused. */
  connect(user: TestUser | null, headers?: Record<string, string>): Promise<TestClient>;
  /** Open a socket as `user` and complete `hello`/`welcome`. */
  connectAs(user: TestUser, options?: ConnectOptions): Promise<TestClient>;
  /** Try an upgrade and return the HTTP status: 101 if accepted (then closed), else the refusal. */
  upgradeStatus(user: TestUser | null, headers?: Record<string, string>): Promise<number>;
  /** Advance the fake clock (firing due hub timers), then `settled()`. */
  advance(ms: number): Promise<void>;
  /** Wait until the server has seen every client close and the hub has finished its work. */
  settled(): Promise<void>;
  /**
   * Simulate a server crash and restart: the running hub dies mid-flight (no more DB writes or
   * timers, so nothing is cleaned up), every socket drops, the clock moves on `downFor` ms, and
   * a new hub boots on the same database. Reconnect with `connectAs` afterwards.
   */
  restart(options?: { downFor?: number }): Promise<void>;
  close(): Promise<void>;
}

export interface RealtimeHarnessOptions {
  /** Passed to `attachRealtime`; the default is generous so tests' anonymous sockets fit. */
  anonymousSocketsPerIp?: number;
  /** Passed to `attachRealtime`; the default is generous so tests can open many sockets per user. */
  socketsPerUser?: number;
  /** Passed to `attachRealtime`; the default trusts nobody's `cf-connecting-ip`. */
  trustedProxies?: readonly string[];
  /** Passed to `attachRealtime`; the default is `MAX_BUFFERED_BYTES`. */
  maxBufferedBytes?: number;
  /** Awaited before each upgrade is authenticated, to hold one in flight. */
  beforeAuthenticate?: (request: IncomingMessage) => Promise<void>;
  /** Wraps the hub's store, to count or hold its calls. */
  wrapStore?: (store: RoomStore) => RoomStore;
}

export async function startRealtimeHarness(
  options: RealtimeHarnessOptions = {},
): Promise<RealtimeHarness> {
  const { db, close: closeDb } = await createTestDb();
  const adminDiscordIds = new Set<string>();
  const auth = createAuth(db, { env: testEnv, adminDiscordIds });
  const clock = new FakeClock();

  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  /** A hub that a simulated crash can kill, attached to `server`. */
  function boot() {
    const store = createDbRoomStore(db);
    const mortal = mortalDeps(clock, options.wrapStore?.(store) ?? store);
    const hub = new RoomHub({ clock: mortal.clock, store: mortal.store });
    const realtime: RealtimeServer = attachRealtime(server, {
      hub,
      authenticate: async (request) => {
        await options.beforeAuthenticate?.(request);
        return callerFromSession(await resolveSession(auth, toHeaders(request)));
      },
      anonymousSocketsPerIp: options.anonymousSocketsPerIp ?? 100,
      socketsPerUser: options.socketsPerUser ?? 100,
      trustedProxies: options.trustedProxies ?? [],
      maxBufferedBytes: options.maxBufferedBytes,
      // Like production: this server has no other upgrade listeners.
      closeUnknownUpgrades: true,
    });
    return { hub, realtime, kill: mortal.kill };
  }
  let running = boot();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `ws://127.0.0.1:${port}${REALTIME_PATH}`;

  const clients = new Set<HarnessClient>();
  let nextDiscordId = 100_000;

  async function createUser(username: string, options: { admin?: boolean; image?: string } = {}) {
    const discordId = String(nextDiscordId++);
    if (options.admin) adminDiscordIds.add(discordId);
    const response = await auth.handler(
      new Request(`${testEnv.BETTER_AUTH_URL}/api/auth/test/sign-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordId, username, image: options.image }),
      }),
    );
    if (!response.ok) throw new Error(`Test sign-in failed: ${await response.text()}`);
    const { userId } = (await response.json()) as { userId: string };
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return { id: userId, username, discordId, cookie };
  }

  function headersFor(user: TestUser | null, extra: Record<string, string> = {}) {
    return { ...(user ? { cookie: user.cookie } : {}), ...extra };
  }

  function connect(
    user: TestUser | null,
    headers?: Record<string, string>,
    options: ConnectOptions = {},
  ) {
    const ws = new WebSocket(url, { headers: headersFor(user, headers) });
    return new Promise<TestClient>((resolve, reject) => {
      ws.once("open", () => {
        const client = wrap(ws, user, options.heartbeat ?? true);
        clients.add(client);
        resolve(client);
      });
      ws.once("unexpected-response", (_request, response) =>
        reject(new Error(`Upgrade refused: ${response.statusCode}`)),
      );
      ws.once("error", reject);
    });
  }

  async function settled() {
    const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
    const open = () => [...clients].filter((c) => !c.isClosed).length;
    while (running.realtime.openSockets > open()) {
      if (Date.now() > deadline) throw new Error("Server never saw a client close");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await running.hub.idle();
  }

  return {
    db,
    clock,
    get hub() {
      return running.hub;
    },
    url,
    createUser,
    async createRoom(host, input = {}) {
      const caller = {
        user: { id: host.id, username: host.username, image: null },
        role: "user" as const,
      };
      const { id } = await createRoom(db, caller, {
        name: "test room",
        kind: "chat",
        tags: [],
        ...input,
      });
      // The hub hears of it (./room-announcements.ts) on its queue: let that land first.
      await running.hub.idle();
      return id;
    },
    connect: (user, headers) => connect(user, headers),
    async connectAs(user, options) {
      const client = await connect(user, undefined, options);
      client.send({ type: "hello", v: PROTOCOL_VERSION });
      await client.waitFor("welcome");
      return client;
    },
    upgradeStatus(user, headers) {
      const ws = new WebSocket(url, { headers: headersFor(user, headers) });
      return new Promise<number>((resolve, reject) => {
        ws.once("open", () => {
          ws.close();
          resolve(101);
        });
        ws.once("unexpected-response", (_request, response) => {
          resolve(response.statusCode ?? 0);
          response.destroy();
        });
        ws.once("error", reject);
      });
    },
    async advance(ms) {
      let remaining = ms;
      do {
        await Promise.all([...clients].map((client) => client.beat()));
        const step = Math.min(remaining, PING_INTERVAL_MS);
        clock.advance(step);
        remaining -= step;
        await settled();
      } while (remaining > 0);
    },
    settled,
    async restart(options = {}) {
      running.kill();
      await running.realtime.close();
      await Promise.all([...clients].map((client) => client.closed()));
      clock.advance(options.downFor ?? 0);
      running = boot();
      await running.hub.idle();
    },
    async close() {
      await Promise.all([...clients].map((client) => client.close()));
      await running.realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb();
    },
  };
}

const isLobbyMessage = (message: ServerMessage) => message.type.startsWith("lobby.");

/**
 * The hub's clock and store, wrapped so `kill()` stops them dead like a crashed process: no
 * timer fires and no DB call happens afterwards.
 */
function mortalDeps(clock: Clock, store: RoomStore) {
  let dead = false;
  const mortalClock: Clock = {
    now: () => clock.now(),
    setTimer: (ms, fn) =>
      clock.setTimer(ms, () => {
        if (!dead) fn();
      }),
  };
  const mortalStore = new Proxy(store, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        dead ? Promise.resolve(undefined) : Reflect.apply(value, target, args);
    },
  });
  return { clock: mortalClock, store: mortalStore, kill: () => (dead = true) };
}

function wrap(ws: WebSocket, user: TestUser | null, heartbeat: boolean): HarnessClient {
  const received: ServerMessage[] = [];
  const unconsumed: ServerMessage[] = [];
  const waiters = new Set<() => void>();
  let protocolError: Error | null = null;
  let closed = false;
  let closeCode = 0;
  let welcomed = false;
  /** Pongs swallowed by the heartbeat. */
  let pongs = 0;

  ws.on("message", (data) => {
    const parsed = parseServerMessage(data.toString());
    if (!parsed.ok) {
      protocolError = new Error(`Server sent an invalid message: ${parsed.error}`);
    } else if (heartbeat && parsed.message.type === "pong") {
      pongs++;
    } else {
      if (parsed.message.type === "welcome") welcomed = true;
      received.push(parsed.message);
      unconsumed.push(parsed.message);
    }
    for (const wake of waiters) wake();
  });
  const closedPromise = new Promise<void>((resolve) => {
    ws.once("close", (code) => {
      closed = true;
      closeCode = code;
      for (const wake of waiters) wake();
      resolve();
    });
  });

  function take<M extends ServerMessage>(
    matches: (message: ServerMessage) => message is M,
    describe: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<M> {
    return new Promise<M>((resolve, reject) => {
      const check = () => {
        if (protocolError) return finish(() => reject(protocolError));
        const index = unconsumed.findIndex(matches);
        if (index >= 0) {
          const [message] = unconsumed.splice(index, 1);
          return finish(() => resolve(message as M));
        }
        if (closed) {
          finish(() => reject(new Error(`Socket closed while waiting for ${describe}`)));
        }
      };
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new Error(
                `Timed out waiting for ${describe}; unconsumed: ${JSON.stringify(unconsumed)}`,
              ),
            ),
          ),
        timeoutMs,
      );
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        waiters.delete(check);
        settle();
      };
      waiters.add(check);
      check();
    });
  }

  const client: HarnessClient = {
    user,
    received,
    send: (message) => ws.send(JSON.stringify(message)),
    sendRaw: (data) => ws.send(data),
    waitFor<T extends ServerMessageType>(
      type: T,
      match?: (message: ServerMessageOf<T>) => boolean,
      timeoutMs?: number,
    ) {
      return take(
        (m): m is ServerMessageOf<T> =>
          m.type === type && (!match || match(m as ServerMessageOf<T>)),
        type,
        timeoutMs,
      );
    },
    waitForEvent<K extends RoomEvent["kind"]>(
      kind: K,
      match?: (message: RoomEventMessage<K>) => boolean,
      timeoutMs?: number,
    ) {
      return take(
        (m): m is RoomEventMessage<K> =>
          m.type === "room.event" &&
          m.event.kind === kind &&
          (!match || match(m as RoomEventMessage<K>)),
        `room.event ${kind}`,
        timeoutMs,
      );
    },
    async join(roomId) {
      client.send({ type: "room.join", roomId });
      return client.waitFor("room.snapshot", (m) => m.roomId === roomId);
    },
    pending: () => unconsumed.filter((m) => !isLobbyMessage(m) && m.type !== "feed.entry"),
    pendingLobby: () => unconsumed.filter(isLobbyMessage),
    pendingFeed: () => unconsumed.filter((m) => m.type === "feed.entry"),
    get isClosed() {
      return closed;
    },
    stopReading: () => ws.pause(),
    resumeReading: () => ws.resume(),
    async closed() {
      await closedPromise;
      return closeCode;
    },
    async close() {
      if (!closed) ws.close();
      await closedPromise;
    },
    beat() {
      if (!heartbeat || !welcomed || closed) return Promise.resolve();
      const want = pongs + 1;
      return new Promise<void>((resolve, reject) => {
        const check = () => {
          if (pongs >= want || closed) finish(resolve);
        };
        const timer = setTimeout(
          () => finish(() => reject(new Error("Timed out waiting for a heartbeat pong"))),
          DEFAULT_TIMEOUT_MS,
        );
        const finish = (settle: () => void) => {
          clearTimeout(timer);
          waiters.delete(check);
          settle();
        };
        waiters.add(check);
        ws.send(JSON.stringify({ type: "ping" } satisfies ClientMessage));
      });
    },
  };
  return client;
}
