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
 *
 * Messages are consumed in order per type: `waitFor(type)` returns the oldest unconsumed
 * message of that type, waiting up to `timeoutMs` for one. `pending()` lists what's unconsumed,
 * so `expect(client.pending()).toEqual([])` after `settled()` asserts nothing else arrived.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { Db } from "../db/client.ts";
import { createTestDb } from "../db/test-db.ts";
import { createAuth } from "../lib/auth.ts";
import {
  type ClientMessage,
  PROTOCOL_VERSION,
  parseServerMessage,
  REALTIME_PATH,
  type RoomEvent,
  type ServerMessage,
  type ServerMessageOf,
  type ServerMessageType,
} from "../lib/realtime.ts";
import type { CreateRoomInput } from "../lib/rooms.ts";
import { FakeClock } from "./clock.ts";
import { attachRealtime, type RealtimeServer } from "./realtime.ts";
import { RoomHub } from "./room-hub.ts";
import { createDbRoomStore } from "./room-store.ts";
import { createRoom } from "./rooms.ts";
import { callerFromSession, resolveSession, toHeaders } from "./session.ts";

const DEFAULT_TIMEOUT_MS = 2_000;

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
  /** Messages received but not yet consumed by a `waitFor`. */
  pending(): ServerMessage[];
  readonly isClosed: boolean;
  /** Close the socket and wait until it's closed. */
  close(): Promise<void>;
}

export interface RealtimeHarness {
  db: Db;
  clock: FakeClock;
  hub: RoomHub;
  /** `ws://127.0.0.1:<port>/ws` */
  url: string;
  /** A signed-in user with a real session, via the test-only sign-in. */
  createUser(username: string, options?: { admin?: boolean }): Promise<TestUser>;
  /** A live public room hosted by `host` (through `createRoom`, like the create dialog). */
  createRoom(host: TestUser, input?: Partial<CreateRoomInput>): Promise<string>;
  /** Open a socket as `user` (null: no cookie) without the handshake. Rejects if refused. */
  connect(user: TestUser | null, headers?: Record<string, string>): Promise<TestClient>;
  /** Open a socket as `user` and complete `hello`/`welcome`. */
  connectAs(user: TestUser): Promise<TestClient>;
  /** Try an upgrade and return the HTTP status: 101 if accepted (then closed), else the refusal. */
  upgradeStatus(user: TestUser | null, headers?: Record<string, string>): Promise<number>;
  /** Advance the fake clock (firing due hub timers), then `settled()`. */
  advance(ms: number): Promise<void>;
  /** Wait until the server has seen every client close and the hub has finished its work. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

export async function startRealtimeHarness(): Promise<RealtimeHarness> {
  const { db, close: closeDb } = await createTestDb();
  const adminDiscordIds = new Set<string>();
  const auth = createAuth(db, { env: testEnv, adminDiscordIds });
  const clock = new FakeClock();
  const hub = new RoomHub({ clock, store: createDbRoomStore(db) });

  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const realtime: RealtimeServer = attachRealtime(server, {
    hub,
    authenticate: async (request) =>
      callerFromSession(await resolveSession(auth, toHeaders(request))),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `ws://127.0.0.1:${port}${REALTIME_PATH}`;

  const clients = new Set<TestClient>();
  let nextDiscordId = 100_000;

  async function createUser(username: string, options: { admin?: boolean } = {}) {
    const discordId = String(nextDiscordId++);
    if (options.admin) adminDiscordIds.add(discordId);
    const response = await auth.handler(
      new Request(`${testEnv.BETTER_AUTH_URL}/api/auth/test/sign-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordId, username }),
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

  function connect(user: TestUser | null, headers?: Record<string, string>) {
    const ws = new WebSocket(url, { headers: headersFor(user, headers) });
    return new Promise<TestClient>((resolve, reject) => {
      ws.once("open", () => {
        const client = wrap(ws, user);
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
    while (realtime.openSockets > open()) {
      if (Date.now() > deadline) throw new Error("Server never saw a client close");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await hub.idle();
  }

  return {
    db,
    clock,
    hub,
    url,
    createUser,
    async createRoom(host, input = {}) {
      const caller = { user: { id: host.id, username: host.username }, role: "user" as const };
      const { id } = await createRoom(db, caller, {
        name: "test room",
        kind: "chat",
        tags: [],
        ...input,
      });
      return id;
    },
    connect,
    async connectAs(user) {
      const client = await connect(user);
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
      clock.advance(ms);
      await settled();
    },
    settled,
    async close() {
      await Promise.all([...clients].map((client) => client.close()));
      await realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb();
    },
  };
}

function wrap(ws: WebSocket, user: TestUser | null): TestClient {
  const received: ServerMessage[] = [];
  const unconsumed: ServerMessage[] = [];
  const waiters = new Set<() => void>();
  let protocolError: Error | null = null;
  let closed = false;

  ws.on("message", (data) => {
    const parsed = parseServerMessage(data.toString());
    if (!parsed.ok) {
      protocolError = new Error(`Server sent an invalid message: ${parsed.error}`);
    } else {
      received.push(parsed.message);
      unconsumed.push(parsed.message);
    }
    for (const wake of waiters) wake();
  });
  const closedPromise = new Promise<void>((resolve) => {
    ws.once("close", () => {
      closed = true;
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

  const client: TestClient = {
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
    pending: () => [...unconsumed],
    get isClosed() {
      return closed;
    },
    async close() {
      if (!closed) ws.close();
      await closedPromise;
    },
  };
  return client;
}
