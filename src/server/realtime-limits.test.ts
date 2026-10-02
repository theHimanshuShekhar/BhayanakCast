import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { rooms } from "../db/schema/index.ts";
import {
  CONNECTION_MESSAGE_BUDGET,
  CONNECTION_RATE_LIMITS,
  FLOOD_CLOSE_CODE,
  MAX_PENDING_MESSAGES,
  MEDIA_OFF,
} from "../lib/realtime.ts";
import {
  type RealtimeHarness,
  type RealtimeHarnessOptions,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";
import type { RoomStore } from "./room-store.ts";

// Per-connection rate limits, the cap on queued work and the per-user socket cap (#60): one
// account can't stall the hub's single queue for everyone else.

let h: RealtimeHarness;
/** Calls the hub made on each store method. */
let calls: Record<string, number>;
/** While set, `isKicked` (the first step of a join) waits for it: a stalled queue. */
let gate: Promise<void> | null;
let releaseGate: () => void;

afterEach(async () => {
  releaseGate?.();
  await h.close();
});

async function start(options: RealtimeHarnessOptions = {}) {
  calls = {};
  gate = null;
  releaseGate = () => {};
  h = await startRealtimeHarness({
    ...options,
    wrapStore: (store) =>
      new Proxy(store, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (typeof value !== "function" || typeof key !== "string") return value;
          return async (...args: unknown[]) => {
            calls[key] = (calls[key] ?? 0) + 1;
            if (key === "isKicked") await gate;
            return Reflect.apply(value, target, args);
          };
        },
      }) as RoomStore,
  });
}

/** Hold the queue: the next `room.join` stalls until `releaseGate()`. */
function stallQueue() {
  gate = new Promise<void>((resolve) => {
    releaseGate = () => {
      gate = null;
      resolve();
    };
  });
}

const SECOND = 1_000;
const WINDOW_MS = 10 * SECOND;
const JOIN = CONNECTION_RATE_LIMITS["room.join"].messages;
const KNOCK = CONNECTION_RATE_LIMITS["knock.request"].messages;
const MEDIA = CONNECTION_RATE_LIMITS["media.state"].messages;

async function inviteTokenOf(roomId: string) {
  const [row] = await h.db
    .select({ inviteToken: rooms.inviteToken })
    .from(rooms)
    .where(eq(rooms.id, roomId));
  if (!row?.inviteToken) throw new Error("Room has no invite token");
  return row.inviteToken;
}

/** Wait for `count` `rate_limited` errors answering `re` (any, if omitted). */
async function rateLimited(client: TestClient, count: number, re?: string) {
  for (let i = 0; i < count; i++) {
    const error = await client.waitFor("error", (e) => !re || e.re === re);
    expect(error.code).toBe("rate_limited");
  }
}

describe("per-connection rate limits", () => {
  it("refuses room.join past the limit without doing the work", async () => {
    await start();
    const ana = await h.createUser("ana");
    const both = [await h.createRoom(ana), await h.createRoom(ana)];
    const a = await h.connectAs(ana);
    const flood = JOIN + 15;
    // Alternating rooms, so no join is the "already here" shortcut.
    for (let i = 0; i < flood; i++) a.send({ type: "room.join", roomId: both[i % 2] as string });
    await rateLimited(a, 15, "room.join");
    await h.settled();

    expect(calls.isKicked).toBe(JOIN);
    expect(a.received.filter((m) => m.type === "room.snapshot")).toHaveLength(JOIN);
    expect(a.isClosed).toBe(false);

    // The window slides: once it has passed, joining works again.
    await h.advance(WINDOW_MS);
    expect((await a.join(both[0] as string)).roomId).toBe(both[0]);
  });

  it("refuses media.state past the limit, so share toggles don't write stream intervals", async () => {
    await start();
    const ana = await h.createUser("ana");
    const roomId = await h.createRoom(ana);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const flood = MEDIA * 3;
    for (let i = 0; i < flood; i++) {
      a.send({ type: "media.state", ...MEDIA_OFF, share: i % 2 === 0 });
    }
    await rateLimited(a, flood - MEDIA, "media.state");
    await h.settled();

    // Twenty toggles were accepted, starting with a share on: ten shares started and ended.
    expect(calls.openStream).toBe(MEDIA / 2);
    expect(calls.closeStream).toBe(MEDIA / 2);
    expect(a.isClosed).toBe(false);
  });

  it("refuses knock.request past the limit", async () => {
    await start();
    const ana = await h.createUser("ana");
    const bo = await h.createUser("bo");
    const roomId = await h.createRoom(ana, { isPrivate: true });
    const inviteToken = await inviteTokenOf(roomId);
    const b = await h.connectAs(bo);
    const flood = KNOCK + 10;
    for (let i = 0; i < flood; i++) b.send({ type: "knock.request", inviteToken });
    await rateLimited(b, 10, "knock.request");
    await h.settled();

    expect(calls.findInvitedRoom).toBe(KNOCK);
    expect(b.isClosed).toBe(false);
  });

  /** Ping until `a` has used its whole budget for the window, having sent `used` frames so far. */
  async function useUpBudget(a: TestClient, used: number) {
    // In batches, each answered before the next: a burst this big in one go would trip the cap
    // on queued messages instead.
    for (let sent = used; sent < CONNECTION_MESSAGE_BUDGET.messages; sent += 100) {
      const batch = Math.min(100, CONNECTION_MESSAGE_BUDGET.messages - sent);
      for (let i = 0; i < batch; i++) a.send({ type: "ping" });
      for (let i = 0; i < batch; i++) await a.waitFor("pong");
    }
  }

  it("drops frames past the budget, telling the socket once per window, and recovers", async () => {
    await start();
    const ana = await h.createUser("ana");
    const a = await h.connectAs(ana, { heartbeat: false });
    await useUpBudget(a, 1); // the hello took one
    for (let i = 0; i < 6; i++) a.send({ type: "ping" });
    await rateLimited(a, 1);
    await h.settled();
    // One refusal for the six, not one each, and the socket stays open.
    expect(a.pending()).toEqual([]);
    expect(a.isClosed).toBe(false);

    await h.advance(WINDOW_MS);
    a.send({ type: "ping" });
    await a.waitFor("pong");
    // A new window tells it again.
    await useUpBudget(a, 1);
    a.send({ type: "ping" });
    await rateLimited(a, 1);
  });

  it("closes a socket that keeps sending past the budget", async () => {
    await start();
    const ana = await h.createUser("ana");
    const a = await h.connectAs(ana, { heartbeat: false });
    await useUpBudget(a, 1);
    // A budget's worth of dropped frames more is tolerated; the next one closes it.
    for (let i = 0; i < CONNECTION_MESSAGE_BUDGET.messages + 1; i++) a.send({ type: "ping" });
    expect(await a.closed()).toBe(FLOOD_CLOSE_CODE);
    // Told when it first went over, and again as it was closed: two replies, not hundreds.
    expect(a.received.filter((m) => m.type === "error")).toHaveLength(2);
  });

  it("keeps another room's chat and heartbeats close to the front of the queue in a flood", async () => {
    await start();
    const ana = await h.createUser("ana");
    const bo = await h.createUser("bo");
    const cy = await h.createUser("cy");
    const [roomA, roomB] = [await h.createRoom(ana), await h.createRoom(bo)];
    const flooder = await h.connectAs(ana);
    const b = await h.connectAs(bo, { heartbeat: false });
    await b.join(roomB);
    const c = await h.connectAs(cy);
    await c.join(roomB);
    await b.waitForEvent("joined");
    const inviteToken = await inviteTokenOf(await h.createRoom(ana, { isPrivate: true }));
    await h.settled();
    expect(h.hub.queued).toBe(0);

    // The flooder's first join stalls the queue, so what gets queued behind it can be counted:
    // its allowed share of the flood, then the other room's ping and chat.
    stallQueue();
    flooder.send({ type: "room.join", roomId: roomA });
    for (let i = 0; i < 100; i++) {
      flooder.send({ type: "room.join", roomId: i % 2 ? roomA : roomB });
      flooder.send({ type: "knock.request", inviteToken });
      flooder.send({ type: "media.state", ...MEDIA_OFF, share: i % 2 === 0 });
    }
    await rateLimited(flooder, 301 - JOIN - KNOCK - MEDIA);
    b.send({ type: "ping" });
    c.send({ type: "chat.send", text: "still here" });

    // Ahead of them are the stalled join and the rest the limits let through, no more (without
    // the limits it would be 300).
    const ahead = JOIN + KNOCK + MEDIA;
    await expect.poll(() => h.hub.queued).toBe(ahead + 2);
    releaseGate();
    await b.waitFor("pong");
    expect(await b.waitFor("chat.message")).toMatchObject({ message: { text: "still here" } });
    await h.settled();
    expect(b.isClosed).toBe(false);
    expect(c.isClosed).toBe(false);
  });
});

describe("queued work per connection", () => {
  it("keeps a flood of join, knock and media messages off a stalled queue", async () => {
    await start();
    const ana = await h.createUser("ana");
    const roomId = await h.createRoom(ana);
    const inviteToken = await inviteTokenOf(await h.createRoom(ana, { isPrivate: true }));
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const joined = calls.isKicked ?? 0;
    const before = h.hub.queued;

    stallQueue();
    a.send({ type: "room.leave" });
    for (let i = 0; i < 100; i++) {
      a.send({ type: "room.join", roomId });
      a.send({ type: "knock.request", inviteToken });
      a.send({ type: "media.state", ...MEDIA_OFF, mic: i % 2 === 0 });
    }
    await rateLimited(a, 300 - JOIN - KNOCK - MEDIA);

    // Only the messages inside the limits are waiting behind the stalled one (plus the leave).
    expect(h.hub.queued - before).toBeLessThanOrEqual(1 + JOIN + KNOCK + MEDIA);
    expect(calls.isKicked).toBe(joined + 1);
    releaseGate();
    await h.settled();
    expect(h.hub.queued).toBe(0);
  });

  it("closes a socket that has too much waiting, and carries on for everyone else", async () => {
    await start();
    const ana = await h.createUser("ana");
    const bo = await h.createUser("bo");
    const roomId = await h.createRoom(ana);
    const flooder = await h.connectAs(ana, { heartbeat: false });
    const other = await h.connectAs(bo, { heartbeat: false });
    const before = h.hub.queued;

    stallQueue();
    flooder.send({ type: "room.join", roomId });
    // Pings are inside the budget, so only the cap on waiting messages stops them.
    for (let i = 0; i < MAX_PENDING_MESSAGES + 20; i++) flooder.send({ type: "ping" });
    expect(await flooder.closed()).toBe(FLOOD_CLOSE_CODE);
    expect(flooder.received.at(-1)).toMatchObject({ type: "error", code: "rate_limited" });
    expect(h.hub.queued - before).toBeLessThanOrEqual(MAX_PENDING_MESSAGES + 2);

    releaseGate();
    await h.settled();
    expect(h.hub.queued).toBe(0);
    // The queued pings of the closed socket were skipped, not answered.
    expect(flooder.received.filter((m) => m.type === "pong")).toEqual([]);
    other.send({ type: "ping" });
    await other.waitFor("pong");
  });
});

describe("normal use stays within the limits", () => {
  it("rejoins after reconnects, re-announcing media each time", async () => {
    await start();
    const ana = await h.createUser("ana");
    const roomId = await h.createRoom(ana);
    let client = await h.connectAs(ana, { heartbeat: false });
    for (let i = 0; i < 5; i++) {
      await client.join(roomId);
      client.send({ type: "media.state", ...MEDIA_OFF, mic: true });
      await h.settled();
      await client.close();
      await h.settled();
      client = await h.connectAs(ana, { heartbeat: false });
    }
    await client.join(roomId);
    expect(client.received.filter((m) => m.type === "error")).toEqual([]);
  });

  it("allows quick share and mic toggling", async () => {
    await start();
    const ana = await h.createUser("ana");
    const roomId = await h.createRoom(ana);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    // A share on and off three times, with the mic and camera toggled between: 12 messages in
    // a few seconds.
    for (let i = 0; i < 3; i++) {
      for (const media of [
        { mic: true, cam: false, share: true },
        { mic: true, cam: true, share: true },
        { mic: false, cam: true, share: false },
        { mic: false, cam: false, share: false },
      ]) {
        a.send({ type: "media.state", ...media });
        await a.waitForEvent("stateChanged");
      }
      await h.advance(SECOND);
    }
    expect(a.received.filter((m) => m.type === "error")).toEqual([]);
    expect(calls.openStream).toBe(3);
  });

  it("lets a person knock, and knock again after a reconnect", async () => {
    await start();
    const ana = await h.createUser("ana");
    const bo = await h.createUser("bo");
    const roomId = await h.createRoom(ana, { isPrivate: true });
    const inviteToken = await inviteTokenOf(roomId);
    const first = await h.connectAs(bo, { heartbeat: false });
    first.send({ type: "knock.request", inviteToken });
    await first.waitFor("knock.status");
    await first.close();
    const second = await h.connectAs(bo, { heartbeat: false });
    second.send({ type: "knock.request", inviteToken });
    expect(await second.waitFor("knock.status")).toMatchObject({ roomId });
    expect(second.received.filter((m) => m.type === "error")).toEqual([]);
  });
});

describe("sockets per signed-in user", () => {
  async function ids() {
    return { ana: await h.createUser("ana"), bo: await h.createUser("bo") };
  }

  it("refuses upgrades past the limit, per user, and frees a slot when a socket closes", async () => {
    await start({ socketsPerUser: 2 });
    const { ana, bo }: { ana: TestUser; bo: TestUser } = await ids();
    const first = await h.connectAs(ana);
    await h.connectAs(ana);
    expect(await h.upgradeStatus(ana)).toBe(429);

    // Other users, and visitors, have their own allowance.
    expect(await h.upgradeStatus(bo)).toBe(101);
    expect(await h.upgradeStatus(null)).toBe(101);

    await first.close();
    await h.settled();
    await expect.poll(() => h.upgradeStatus(ana)).toBe(101);
  });

  it("still lets a second tab take over the room", async () => {
    await start({ socketsPerUser: 2 });
    const { ana } = await ids();
    const roomId = await h.createRoom(ana);
    const tab1 = await h.connectAs(ana);
    await tab1.join(roomId);
    const tab2 = await h.connectAs(ana);
    await tab2.join(roomId);
    expect(await tab1.waitFor("error")).toMatchObject({ code: "taken_over" });
    expect(tab1.isClosed).toBe(false);
  });
});
