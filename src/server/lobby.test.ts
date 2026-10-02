/**
 * The lobby channel (ADR 20, #24): anonymous sockets, the online count and public room
 * changes, through real sockets (./realtime-harness.ts).
 */
import { connect as connectTcp } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  IDLE_TIMEOUT_MS,
  PROTOCOL_VERSION,
  type ServerMessage,
  type ServerMessageOf,
} from "../lib/realtime.ts";
import { RealtimeClient } from "../lib/realtime-client.ts";
import {
  type RealtimeHarness,
  type RealtimeHarnessOptions,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";
import { announceRoom } from "./room-announcements.ts";
import { RECONNECT_GRACE_MS } from "./room-hub.ts";

let h: RealtimeHarness;
const SECOND = 1_000;

// Each describe boots its harness in a `beforeEach` with its own options: booting and migrating
// PGlite then counts against the hook timeout, not the test's.
async function start(options?: RealtimeHarnessOptions) {
  h = await startRealtimeHarness(options);
}

afterEach(async () => {
  await h.close();
});

/**
 * An anonymous socket, handshake done; returns it with its lobby snapshot. It counts online
 * once per `visitorId`, or on its own without one.
 */
async function visitor(headers?: Record<string, string>, visitorId?: string) {
  const client = await h.connect(null, headers);
  client.send({ type: "hello", v: PROTOCOL_VERSION, ...(visitorId ? { visitorId } : {}) });
  expect(await client.waitFor("welcome")).toEqual({
    type: "welcome",
    v: PROTOCOL_VERSION,
    user: null,
  });
  return { client, snapshot: await client.waitFor("lobby.snapshot") };
}

/** The next `lobby.changed` on `client`. */
const nextChange = (client: TestClient) => client.waitFor("lobby.changed");

describe("anonymous sockets", () => {
  beforeEach(() => start());

  it("are accepted, get the lobby snapshot, and have everything but heartbeat refused", async () => {
    expect(await h.upgradeStatus(null)).toBe(101);
    const ana = await h.createUser("ana");
    const roomId = await h.createRoom(ana);

    const anon = await h.connect(null);
    // Refused before the handshake too, as forbidden rather than "send hello first".
    anon.send({ type: "room.join", roomId });
    expect(await anon.waitFor("error")).toMatchObject({ code: "forbidden", re: "room.join" });

    anon.send({ type: "hello", v: PROTOCOL_VERSION });
    expect(await anon.waitFor("welcome")).toMatchObject({ user: null });
    // The visitor is online themself.
    expect(await anon.waitFor("lobby.snapshot")).toEqual({ type: "lobby.snapshot", online: 1 });

    for (const message of [
      { type: "room.join", roomId } as const,
      { type: "room.leave" } as const,
      { type: "chat.send", text: "hi" } as const,
    ]) {
      anon.send(message);
      expect(await anon.waitFor("error")).toMatchObject({ code: "forbidden", re: message.type });
    }
    anon.sendRaw("not json");
    expect(await anon.waitFor("error")).toMatchObject({ code: "bad_request" });
    await h.settled();
    expect(anon.pending()).toEqual([]);
  });

  it("hear lobby events only, never room traffic", async () => {
    const ana = await h.createUser("ana");
    const bo = await h.createUser("bo");
    const { client: anon } = await visitor();

    const roomId = await h.createRoom(ana);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");
    b.send({ type: "room.leave" });
    await a.waitForEvent("left");
    await h.settled();

    expect(new Set(anon.received.map((m) => m.type))).toEqual(
      new Set(["welcome", "lobby.snapshot", "lobby.changed"]),
    );
    expect(anon.pending()).toEqual([]);
  });
});

describe("online users", () => {
  beforeEach(() => start());

  it("counts distinct signed-in users with an open socket as they come and go", async () => {
    const [ana, bo, cy] = [
      await h.createUser("ana"),
      await h.createUser("bo"),
      await h.createUser("cy"),
    ];
    // The observer is a signed-in user, so it counts itself.
    const observer = await h.connectAs(cy);
    expect((await observer.waitFor("lobby.snapshot")).online).toBe(1);

    const a1 = await h.connectAs(ana);
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 2 });
    expect(await a1.waitFor("lobby.snapshot")).toEqual({ type: "lobby.snapshot", online: 2 });

    // A second socket of the same user changes nothing.
    const a2 = await h.connectAs(ana);
    expect((await a2.waitFor("lobby.snapshot")).online).toBe(2);

    const b = await h.connectAs(bo);
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 3 });
    expect(await nextChange(a1)).toEqual({ type: "lobby.changed", online: 3 });
    expect((await b.waitFor("lobby.snapshot")).online).toBe(3);

    await a1.close();
    await h.settled();
    expect(observer.pendingLobby()).toEqual([]);
    await a2.close();
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 2 });
    await b.close();
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 1 });
    await h.settled();
    expect(observer.pendingLobby()).toEqual([]);
  });
});

describe("online visitors", () => {
  const BROWSER_A = "6f0c8a52-3f1e-4c53-9d7e-2a1b0c9d8e71";
  const BROWSER_B = "b4e1d7a9-5c02-4f6b-8a3d-91c7e2f04b68";
  let observer: TestClient;

  /** The online count of the last `lobby.changed` the observer heard. */
  const lastOnline = () => observer.received.findLast((m) => m.type === "lobby.changed")?.online;

  /** A signed-in observer: it is online itself, so the count starts at 1. */
  beforeEach(async () => {
    await start();
    observer = await h.connectAs(await h.createUser("ana"));
    expect((await observer.waitFor("lobby.snapshot")).online).toBe(1);
  });

  it("counts a visitor in their own snapshot, and every tab of one browser once", async () => {
    const tab1 = await visitor(undefined, BROWSER_A);
    expect(tab1.snapshot.online).toBe(2);
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 2 });

    const tab2 = await visitor(undefined, BROWSER_A);
    expect(tab2.snapshot.online).toBe(2);
    await h.settled();
    expect(observer.pendingLobby()).toEqual([]);

    // Closing one of two tabs doesn't lower it; the last one does.
    await tab1.client.close();
    await h.settled();
    expect(observer.pendingLobby()).toEqual([]);
    await tab2.client.close();
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 1 });
  });

  it("counts a different browser separately", async () => {
    const a = await visitor(undefined, BROWSER_A);
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 2 });
    const b = await visitor(undefined, BROWSER_B);
    expect(b.snapshot.online).toBe(3);
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 3 });
    // The first visitor hears the second's arrival too.
    expect(await nextChange(a.client)).toEqual({ type: "lobby.changed", online: 3 });

    await a.client.close();
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 2 });
    await b.client.close();
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 1 });
  });

  it("counts a socket with a missing or malformed id on its own, and still welcomes it", async () => {
    const bare = await visitor();
    expect(bare.snapshot.online).toBe(2);
    await visitor();
    for (const bad of ["not-a-uuid", 42, ""]) {
      const client = await h.connect(null);
      client.sendRaw(JSON.stringify({ type: "hello", v: PROTOCOL_VERSION, visitorId: bad }));
      expect(await client.waitFor("welcome")).toMatchObject({ user: null });
      await client.waitFor("lobby.snapshot");
    }
    await h.settled();
    expect(observer.pendingLobby().map((m) => (m as { online: number }).online)).toEqual([
      2, 3, 4, 5, 6,
    ]);

    // Two sockets without ids aren't one visitor: closing one lowers the count.
    await bare.client.close();
    await expect.poll(lastOnline).toBe(5);
  });

  it("ignores the visitor id of a signed-in socket", async () => {
    const bo = await h.createUser("bo");
    const signedIn = await h.connect(bo);
    signedIn.send({ type: "hello", v: PROTOCOL_VERSION, visitorId: BROWSER_A });
    expect(await signedIn.waitFor("welcome")).toMatchObject({ user: { username: "bo" } });
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 2 });

    // The same id on an anonymous socket is a visitor of its own, not bo.
    await visitor(undefined, BROWSER_A);
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 3 });

    // Closing bo's socket drops the user only.
    await signedIn.close();
    expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 2 });
  });

  it("counts a socket once however often it says hello", async () => {
    const { client } = await visitor(undefined, BROWSER_A);
    client.send({ type: "hello", v: PROTOCOL_VERSION, visitorId: BROWSER_B });
    await client.waitFor("welcome");
    await h.settled();
    expect(observer.pendingLobby()).toEqual([{ type: "lobby.changed", online: 2 }]);
    await client.close();
    await expect.poll(lastOnline).toBe(1);
  });

  it("doesn't count a socket that never said hello", async () => {
    const silent = await h.connect(null);
    await h.settled();
    expect(observer.pendingLobby()).toEqual([]);
    await silent.close();
    await h.settled();
    expect(observer.pendingLobby()).toEqual([]);
  });
});

describe("public room changes", () => {
  beforeEach(() => start());

  let ana: TestUser;
  let bo: TestUser;

  /** The next room change `client` hears, with the online count it came with. */
  async function nextRoomChange(client: TestClient) {
    const message: ServerMessageOf<"lobby.changed"> = await client.waitFor(
      "lobby.changed",
      (m) => m.room !== undefined,
    );
    return message;
  }

  it("announces created rooms and every participant count change", async () => {
    ana = await h.createUser("ana");
    bo = await h.createUser("bo");
    const { client: anon } = await visitor();

    const roomId = await h.createRoom(ana);
    expect(await nextRoomChange(anon)).toEqual({
      type: "lobby.changed",
      online: 1,
      room: { roomId, change: "created", participantCount: 0 },
    });

    const a = await h.connectAs(ana);
    await a.join(roomId);
    expect((await nextRoomChange(anon)).room).toEqual({
      roomId,
      change: "count",
      participantCount: 1,
    });
    const b = await h.connectAs(bo);
    await b.join(roomId);
    expect((await nextRoomChange(anon)).room).toMatchObject({ roomId, participantCount: 2 });

    b.send({ type: "room.leave" });
    expect((await nextRoomChange(anon)).room).toMatchObject({ roomId, participantCount: 1 });
    await a.close();
    await h.advance(RECONNECT_GRACE_MS); // a dropped socket leaves the room after the grace
    expect(await nextRoomChange(anon)).toEqual({
      type: "lobby.changed",
      online: 2,
      room: { roomId, change: "count", participantCount: 0 },
    });

    // Signed-in sockets (in a room or not) hear the same lobby.
    for (const participantCount of [2, 1, 0]) {
      expect((await nextRoomChange(b)).room).toEqual({ roomId, change: "count", participantCount });
    }
  });

  it("never mentions a private room", async () => {
    ana = await h.createUser("ana");
    bo = await h.createUser("bo");
    const { client: anon } = await visitor();
    const b = await h.connectAs(bo);

    const privateRoom = await h.createRoom(ana, { isPrivate: true });
    const a = await h.connectAs(ana);
    await a.join(privateRoom);
    a.send({ type: "room.leave" });
    await a.close();
    // A public room afterwards, so the lobby demonstrably kept talking.
    const publicRoom = await h.createRoom(bo);
    expect((await nextRoomChange(anon)).room).toMatchObject({ roomId: publicRoom });
    await h.settled();

    // Nobody's lobby traffic names it, not even the host's own.
    for (const client of [anon, b, a]) {
      const lobby = client.received.filter((m) => m.type.startsWith("lobby."));
      expect(lobby.length).toBeGreaterThan(0);
      expect(JSON.stringify(lobby)).not.toContain(privateRoom);
    }
    expect(JSON.stringify([...anon.received, ...b.received])).not.toContain(privateRoom);
  });
});

describe("thumbnail uploads", () => {
  beforeEach(() => start());

  it("tell the lobby about a public room, never about a private one", async () => {
    const ana = await h.createUser("ana");
    const { client: anon } = await visitor();
    const publicRoom = await h.createRoom(ana);
    const privateRoom = await h.createRoom(ana, { isPrivate: true });
    await h.settled();

    announceRoom({ kind: "thumbnail", roomId: privateRoom });
    announceRoom({ kind: "thumbnail", roomId: "unknown" });
    announceRoom({ kind: "thumbnail", roomId: publicRoom });
    const change = await anon.waitFor("lobby.changed", (m) => m.room?.change === "thumbnail");
    expect(change.room).toEqual({
      roomId: publicRoom,
      change: "thumbnail",
      participantCount: 0,
    });
    await h.settled();
    expect(JSON.stringify(anon.received)).not.toContain(privateRoom);
  });
});

describe("with the reconnect grace", () => {
  beforeEach(() => start());

  it("drops a user from online with their last socket, but the room count after the grace", async () => {
    const [ana, bo] = [await h.createUser("ana"), await h.createUser("bo")];
    const { client: anon } = await visitor();
    const roomId = await h.createRoom(ana);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await anon.waitFor("lobby.changed", (m) => m.room?.participantCount === 2);
    await h.settled();
    const seenBefore = anon.received.length;

    await b.close();
    // Online follows open sockets: bo is offline at once.
    const changesSince = () =>
      anon.received.slice(seenBefore).filter((m) => m.type === "lobby.changed");
    await expect.poll(changesSince).toEqual([{ type: "lobby.changed", online: 2 }]);
    await h.advance(RECONNECT_GRACE_MS - SECOND);
    expect(changesSince()).toEqual([{ type: "lobby.changed", online: 2 }]);

    // Once the grace runs out bo leaves the room, and the lobby hears the new count.
    await h.advance(SECOND);
    await expect.poll(changesSince).toEqual([
      { type: "lobby.changed", online: 2 },
      {
        type: "lobby.changed",
        online: 2,
        room: { roomId, change: "count", participantCount: 1 },
      },
    ]);
  });

  it("keeps a heartbeating anonymous socket open past the idle timeout, pings not refused", async () => {
    const { client: anon } = await visitor();
    await h.advance(2 * IDLE_TIMEOUT_MS);
    expect(anon.isClosed).toBe(false);
    expect(anon.pending()).toEqual([]);
  });
});

describe("per-IP limit on anonymous sockets", () => {
  describe("with a client that leaves while its upgrade is being authenticated", () => {
    beforeEach(() =>
      start({
        anonymousSocketsPerIp: 1,
        beforeAuthenticate: (request) =>
          request.headers["x-drop"]
            ? new Promise<void>((resolve) => {
                request.socket.once("close", () => resolve());
                request.socket.destroy();
              })
            : Promise.resolve(),
      }),
    );

    it("frees its slot", async () => {
      // The client's connection drops (and `close` fires) while the upgrade is being authenticated.
      await new Promise<void>((resolve, reject) => {
        const socket = connectTcp(Number(new URL(h.url).port), "127.0.0.1");
        socket.on("error", reject);
        socket.on("close", () => resolve());
        socket.write(
          "GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nx-drop: 1\r\n\r\n",
        );
      });
      expect(await h.upgradeStatus(null)).toBe(101);
    });
  });

  describe("by socket address", () => {
    beforeEach(() => start({ anonymousSocketsPerIp: 2 }));

    it("refuses anonymous upgrades past the limit", async () => {
      const ana = await h.createUser("ana");
      const first = await h.connect(null);
      await h.connect(null);
      expect(await h.upgradeStatus(null)).toBe(429);

      // Signed-in sockets aren't limited this way.
      expect(await h.upgradeStatus(ana)).toBe(101);

      // A peer that isn't a trusted proxy can't dodge the limit with its own cf-connecting-ip.
      expect(await h.upgradeStatus(null, { "cf-connecting-ip": "203.0.113.7" })).toBe(429);

      // A closed socket frees its slot.
      await first.close();
      await h.settled();
      await expect.poll(() => h.upgradeStatus(null)).toBe(101);
    });
  });

  describe("behind a trusted proxy (the tunnel)", () => {
    beforeEach(() => start({ anonymousSocketsPerIp: 2, trustedProxies: ["127.0.0.1", "::1"] }));

    it("counts by cf-connecting-ip", async () => {
      const first = await h.connect(null);
      await h.connect(null);
      expect(await h.upgradeStatus(null)).toBe(429);

      // Behind Cloudflare the client IP comes from cf-connecting-ip.
      const cf = { "cf-connecting-ip": "203.0.113.7" };
      await h.connect(null, cf);
      await h.connect(null, cf);
      expect(await h.upgradeStatus(null, cf)).toBe(429);
      expect(await h.upgradeStatus(null, { "cf-connecting-ip": "203.0.113.8" })).toBe(101);

      // A closed socket frees its slot.
      await first.close();
      await h.settled();
      await expect.poll(() => h.upgradeStatus(null)).toBe(101);
    });
  });
});

describe("signing in", () => {
  beforeEach(() => start());

  it("upgrades the page's socket to authenticated when the client restarts it", async () => {
    const ana = await h.createUser("ana");
    // Another browser, online throughout: it hears the count settle at two, itself and the page
    // below (a visitor, then ana).
    const { client: observer } = await visitor();
    const observed = () => observer.received.findLast((m) => m.type === "lobby.changed")?.online;
    // What a newcomer would be told: that browser, the page below and the probe itself.
    const probe = async () => {
      const { client, snapshot } = await visitor();
      await client.close();
      return snapshot.online;
    };

    // The browser's client, with the session cookie a browser would send at the upgrade.
    let cookie: string | null = null;
    class BrowserLikeWebSocket extends WebSocket {
      constructor(url: string) {
        super(url, { headers: cookie ? { cookie } : {} });
      }
    }
    const client = new RealtimeClient(h.url, {
      WebSocket: BrowserLikeWebSocket as unknown as typeof globalThis.WebSocket,
      backoff: () => 10,
    });
    const received: ServerMessage[] = [];
    client.subscribe((message) => received.push(message));
    const welcomes = () => received.filter((m) => m.type === "welcome").map((m) => m.user);
    try {
      client.start();
      await expect.poll(welcomes).toEqual([null]);
      expect(await probe()).toBe(3);
      await expect.poll(observed).toBe(2);

      // Their anonymous socket closes as the authenticated one opens: still one person.
      cookie = ana.cookie; // signed in (e.g. in another tab)
      client.restart();
      await expect.poll(welcomes).toEqual([null, { id: ana.id, username: "ana", image: null }]);
      await expect.poll(probe).toBe(3);
      await expect.poll(observed).toBe(2);

      cookie = null; // signed out
      client.restart();
      await expect.poll(() => welcomes().length).toBe(3);
      expect(welcomes()[2]).toBeNull();
      await expect.poll(probe).toBe(3);
      await expect.poll(observed).toBe(2);
    } finally {
      client.stop();
    }
  });
});
