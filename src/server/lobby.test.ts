/**
 * The lobby channel (ADR 20, #24): anonymous sockets, the online-user count and public room
 * changes, through real sockets (./realtime-harness.ts).
 */
import { afterEach, describe, expect, it } from "vitest";
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
import { RECONNECT_GRACE_MS } from "./room-hub.ts";

let h: RealtimeHarness;
const SECOND = 1_000;

async function start(options?: RealtimeHarnessOptions) {
  h = await startRealtimeHarness(options);
}

afterEach(async () => {
  await h.close();
});

/** An anonymous socket, handshake done; returns it with its lobby snapshot. */
async function visitor(headers?: Record<string, string>) {
  const client = await h.connect(null, headers);
  client.send({ type: "hello", v: PROTOCOL_VERSION });
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
  it("are accepted, get the lobby snapshot, and have everything but heartbeat refused", async () => {
    await start();
    expect(await h.upgradeStatus(null)).toBe(101);
    const ana = await h.createUser("ana");
    const roomId = await h.createRoom(ana);

    const anon = await h.connect(null);
    // Refused before the handshake too, as forbidden rather than "send hello first".
    anon.send({ type: "room.join", roomId });
    expect(await anon.waitFor("error")).toMatchObject({ code: "forbidden", re: "room.join" });

    anon.send({ type: "hello", v: PROTOCOL_VERSION });
    expect(await anon.waitFor("welcome")).toMatchObject({ user: null });
    expect(await anon.waitFor("lobby.snapshot")).toEqual({ type: "lobby.snapshot", online: 0 });

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
    await start();
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
  it("counts distinct signed-in users with an open socket as they come and go", async () => {
    await start();
    const [ana, bo] = [await h.createUser("ana"), await h.createUser("bo")];
    const { client: anon, snapshot } = await visitor();
    expect(snapshot.online).toBe(0);
    // Another anonymous socket doesn't count.
    await visitor();

    const a1 = await h.connectAs(ana);
    expect(await nextChange(anon)).toEqual({ type: "lobby.changed", online: 1 });
    expect(await a1.waitFor("lobby.snapshot")).toEqual({ type: "lobby.snapshot", online: 1 });

    // A second socket of the same user changes nothing.
    const a2 = await h.connectAs(ana);
    expect((await a2.waitFor("lobby.snapshot")).online).toBe(1);

    const b = await h.connectAs(bo);
    expect(await nextChange(anon)).toEqual({ type: "lobby.changed", online: 2 });
    expect(await nextChange(a1)).toEqual({ type: "lobby.changed", online: 2 });
    expect((await b.waitFor("lobby.snapshot")).online).toBe(2);

    await a1.close();
    await h.settled();
    expect(anon.pendingLobby()).toEqual([]);
    await a2.close();
    expect(await nextChange(anon)).toEqual({ type: "lobby.changed", online: 1 });
    await b.close();
    expect(await nextChange(anon)).toEqual({ type: "lobby.changed", online: 0 });
    await h.settled();
    expect(anon.pendingLobby()).toEqual([]);
  });
});

describe("public room changes", () => {
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
    await start();
    ana = await h.createUser("ana");
    bo = await h.createUser("bo");
    const { client: anon } = await visitor();

    const roomId = await h.createRoom(ana);
    expect(await nextRoomChange(anon)).toEqual({
      type: "lobby.changed",
      online: 0,
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
      online: 1,
      room: { roomId, change: "count", participantCount: 0 },
    });

    // Signed-in sockets (in a room or not) hear the same lobby.
    for (const participantCount of [2, 1, 0]) {
      expect((await nextRoomChange(b)).room).toEqual({ roomId, change: "count", participantCount });
    }
  });

  it("never mentions a private room", async () => {
    await start();
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

describe("with the reconnect grace", () => {
  it("drops a user from online with their last socket, but the room count after the grace", async () => {
    await start();
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
    await expect.poll(changesSince).toEqual([{ type: "lobby.changed", online: 1 }]);
    await h.advance(RECONNECT_GRACE_MS - SECOND);
    expect(changesSince()).toEqual([{ type: "lobby.changed", online: 1 }]);

    // Once the grace runs out bo leaves the room, and the lobby hears the new count.
    await h.advance(SECOND);
    await expect.poll(changesSince).toEqual([
      { type: "lobby.changed", online: 1 },
      {
        type: "lobby.changed",
        online: 1,
        room: { roomId, change: "count", participantCount: 1 },
      },
    ]);
  });

  it("keeps a heartbeating anonymous socket open past the idle timeout, pings not refused", async () => {
    await start();
    const { client: anon } = await visitor();
    await h.advance(2 * IDLE_TIMEOUT_MS);
    expect(anon.isClosed).toBe(false);
    expect(anon.pending()).toEqual([]);
  });
});

describe("per-IP limit on anonymous sockets", () => {
  it("refuses anonymous upgrades past the limit, by socket address", async () => {
    await start({ anonymousSocketsPerIp: 2 });
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

  it("counts by cf-connecting-ip when the peer is a trusted proxy (the tunnel)", async () => {
    await start({ anonymousSocketsPerIp: 2, trustedProxies: ["127.0.0.1", "::1"] });
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

describe("signing in", () => {
  it("upgrades the page's socket to authenticated when the client restarts it", async () => {
    await start();
    const ana = await h.createUser("ana");
    const { client: observer } = await visitor();

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

      cookie = ana.cookie; // signed in (e.g. in another tab)
      client.restart();
      await expect.poll(welcomes).toEqual([null, { id: ana.id, username: "ana" }]);
      expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 1 });
      await expect.poll(() => received.at(-1)).toEqual({ type: "lobby.snapshot", online: 1 });

      cookie = null; // signed out
      client.restart();
      await expect.poll(() => welcomes().length).toBe(3);
      expect(welcomes()[2]).toBeNull();
      expect(await nextChange(observer)).toEqual({ type: "lobby.changed", online: 0 });
    } finally {
      client.stop();
    }
  });
});
