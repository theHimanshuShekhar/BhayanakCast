import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { presenceIntervals, rooms } from "../db/schema/index.ts";
import { type RealtimeHarness, startRealtimeHarness, type TestUser } from "./realtime-harness.ts";
import {
  EMPTY_ROOM_TIMEOUT_MS,
  HOST_GRACE_MS,
  RECONNECT_GRACE_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
} from "./room-hub.ts";
import type { RoomStore } from "./room-store.ts";

// A database write that fails must not strand the hub's bookkeeping (#62): leaving and ending a
// room still do their in-memory follow-ups, an end that didn't land is retried with a backoff,
// and restart recovery retries until it succeeds.

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let cy: TestUser;
let roomId: string;
let error: MockInstance<typeof console.error>;

/** Store method -> how many more of its calls fail (`Infinity`: until cleared). */
let failing: Map<string, number>;
/** Store calls so far, by method. */
let calls: Record<string, number>;

beforeEach(async () => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  failing = new Map();
  calls = {};
  h = await startRealtimeHarness({
    wrapStore: (store) =>
      new Proxy(store, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (typeof value !== "function" || typeof key !== "string") return value;
          return async (...args: unknown[]) => {
            calls[key] = (calls[key] ?? 0) + 1;
            const left = failing.get(key);
            if (left) {
              failing.set(key, left - 1);
              throw new Error(`${key} is down`);
            }
            return Reflect.apply(value, target, args);
          };
        },
      }) as RoomStore,
  });
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  cy = await h.createUser("cy");
  roomId = await h.createRoom(ana);
});

afterEach(async () => {
  await h.close();
  vi.restoreAllMocks();
});

const SECOND = 1_000;
const T0 = "2026-09-01T12:00:00.000Z";
/** T0 plus `s` seconds, as an ISO string. */
const t = (s: number) => new Date(Date.parse(T0) + s * SECOND).toISOString();
const iso = (at: Date | null | undefined) => at?.toISOString() ?? null;

async function roomRow() {
  const [row] = await h.db.select().from(rooms).where(eq(rooms.id, roomId));
  return {
    lastEmptyAt: iso(row?.lastEmptyAt),
    endedAt: iso(row?.endedAt),
    rolledUp: row?.statsRolledUpAt != null,
  };
}

/** Whether the hub logged a failure whose message mentions `text`. */
const logged = (text: string) =>
  error.mock.calls.some(([message]) => typeof message === "string" && message.includes(text));

/** ana joins and leaves at once, so the room is empty since T0. */
async function joinAndLeave() {
  const a = await h.connectAs(ana);
  await a.join(roomId);
  a.send({ type: "room.leave" });
  await h.advance(0);
  return a;
}

describe("leaving when the database write fails", () => {
  it("still starts the host grace, hands host on, and updates the lobby", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    const watcher = await h.connectAs(cy);
    failing.set("closePresence", Infinity);

    a.send({ type: "room.leave" });
    expect((await b.waitForEvent("left")).event).toEqual({ kind: "left", userId: ana.id });
    expect((await b.waitForEvent("hostChanged")).event).toEqual({
      kind: "hostChanged",
      hostUserId: ana.id,
      graceUntil: t(HOST_GRACE_MS / SECOND),
    });
    expect(
      await watcher.waitFor(
        "lobby.changed",
        (m) => m.room?.change === "count" && m.room.participantCount === 1,
      ),
    ).toBeDefined();
    expect(logged("closing a presence interval failed")).toBe(true);

    await h.advance(HOST_GRACE_MS);
    expect((await b.waitForEvent("hostChanged")).event).toMatchObject({ hostUserId: bo.id });
  });

  it("still ends the emptied room on time, whether or not lastEmptyAt was written", async () => {
    failing.set("closePresence", Infinity);
    failing.set("markRoomEmpty", Infinity);
    await joinAndLeave();
    expect(await roomRow()).toEqual({ lastEmptyAt: null, endedAt: null, rolledUp: false });
    expect(logged("marking a room empty failed")).toBe(true);

    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: null, endedAt: T0, rolledUp: true });
    // The interval the failed write left open closed with the room.
    const [interval] = await h.db
      .select({ endedAt: presenceIntervals.endedAt })
      .from(presenceIntervals)
      .where(eq(presenceIntervals.roomId, roomId));
    expect(iso(interval?.endedAt)).toBe(T0);
  });

  it("still ends the room when the last person's reconnect grace runs out", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    failing.set("closePresence", Infinity);
    await a.close();
    // The empty-room wait starts when the grace's step has finished, hence the extra step.
    await h.advance(RECONNECT_GRACE_MS + EMPTY_ROOM_TIMEOUT_MS + 30 * SECOND);
    expect((await roomRow()).endedAt).toBe(t(0));
  });
});

describe("joining an empty room when the database write fails", () => {
  it.each(["markRoomOccupied", "openPresence"])(
    "keeps the empty-room timer when %s throws",
    async (method) => {
      await joinAndLeave();
      await h.advance(60 * SECOND);
      failing.set(method, 1);
      const b = await h.connectAs(bo);
      b.send({ type: "room.join", roomId });
      expect(await b.waitFor("error")).toMatchObject({ code: "internal", re: "room.join" });

      // Still empty since T0 (the wait starts over from the failed join, but dates from then).
      await h.advance(EMPTY_ROOM_TIMEOUT_MS);
      expect(await roomRow()).toEqual({ lastEmptyAt: t(0), endedAt: T0, rolledUp: true });
    },
  );
});

describe("handing host on when the database write fails", () => {
  it("keeps the host, then retries the hand-over with a backoff", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    failing.set("setHost", Infinity);
    calls = {};

    a.send({ type: "room.leave" });
    // The grace is announced as usual; when it runs out the hand-over fails and nothing changes.
    expect((await b.waitForEvent("hostChanged")).event).toMatchObject({ hostUserId: ana.id });
    await h.advance(HOST_GRACE_MS);
    expect(calls.setHost).toBe(1);
    expect(
      logged(`handing host over in room ${roomId} failed (try 1), trying again in 1000 ms`),
    ).toBe(true);
    await b.waitForEvent("left");
    expect(b.pending()).toEqual([]);

    failing.delete("setHost");
    await h.advance(RETRY_BASE_MS);
    expect(calls.setHost).toBe(2);
    expect((await b.waitForEvent("hostChanged")).event).toMatchObject({ hostUserId: bo.id });
  });

  it("still removes a banned host, and passes host on after the grace", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    failing.set("setHost", Infinity);

    await h.hub.disconnectUser(ana.id, "banned for testing");
    expect(await a.waitFor("error")).toMatchObject({ code: "banned" });
    await a.closed();
    expect((await b.waitForEvent("left")).event).toEqual({ kind: "left", userId: ana.id });
    expect((await b.waitForEvent("hostChanged")).event).toMatchObject({ hostUserId: ana.id });

    failing.delete("setHost");
    await h.advance(HOST_GRACE_MS);
    expect((await b.waitForEvent("hostChanged")).event).toMatchObject({ hostUserId: bo.id });
  });

  it("still removes a kicked host", async () => {
    const admin = await h.createUser("root", { admin: true });
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const r = await h.connectAs(admin);
    await r.join(roomId);
    failing.set("setHost", Infinity);

    r.send({ type: "mod.kick", userId: ana.id });
    expect((await r.waitForEvent("kicked")).event).toMatchObject({ userId: ana.id });
    expect(await a.waitFor("error", (m) => m.code === "kicked")).toBeDefined();
  });
});

describe("ending a room when the database write fails", () => {
  it("keeps it ended here, retries with a doubling backoff, and settles when the database is back", async () => {
    await joinAndLeave();
    const watcher = await h.connectAs(cy);
    failing.set("endRoom", Infinity);

    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    // Ended for the people here at once: the lobby hears it, and nobody can reopen it...
    expect(await watcher.waitFor("lobby.changed", (m) => m.room?.change === "ended")).toBeDefined();
    const b = await h.connectAs(bo);
    b.send({ type: "room.join", roomId });
    expect(await b.waitFor("error")).toMatchObject({ code: "not_found", re: "room.join" });
    // ...though the database still says live.
    expect((await roomRow()).endedAt).toBeNull();
    expect(logged(`ending room ${roomId} failed (try 1)`)).toBe(true);
    expect(calls.endRoom).toBe(1);

    // Tries after 1 s, then 2 s, then 4 s.
    await h.advance(RETRY_BASE_MS - 1);
    expect(calls.endRoom).toBe(1);
    await h.advance(1);
    expect(calls.endRoom).toBe(2);
    await h.advance(2 * RETRY_BASE_MS - 1);
    expect(calls.endRoom).toBe(2);
    await h.advance(1);
    expect(calls.endRoom).toBe(3);

    failing.delete("endRoom");
    await h.advance(4 * RETRY_BASE_MS);
    expect(calls.endRoom).toBe(4);
    expect(await roomRow()).toEqual({ lastEmptyAt: t(0), endedAt: T0, rolledUp: true });

    // Done: no more tries, and the room stays closed to joins.
    await h.advance(RETRY_MAX_MS * 2);
    expect(calls.endRoom).toBe(4);
    b.send({ type: "room.join", roomId });
    expect(await b.waitFor("error")).toMatchObject({ code: "not_found" });
  });

  it("stops doubling the wait at the cap", async () => {
    await joinAndLeave();
    failing.set("endRoom", Infinity);
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    // 1 + 2 + 4 + 8 + 16 s, then every 30 s. (One step per wait: a retry is scheduled after the
    // step that fired its timer has moved the clock.)
    for (const wait of [1, 2, 4, 8, 16]) await h.advance(wait * SECOND);
    expect(calls.endRoom).toBe(6);
    await h.advance(RETRY_MAX_MS - 1);
    expect(calls.endRoom).toBe(6);
    await h.advance(1);
    expect(calls.endRoom).toBe(7);
  });

  it("leaves a failed roll-up to the daily purge: the end landed, so nothing is retried", async () => {
    await joinAndLeave();
    failing.set("rollupEndedRoom", Infinity);
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: t(0), endedAt: T0, rolledUp: false });
    expect(logged("rolling up a room's stats failed")).toBe(true);

    await h.advance(RETRY_MAX_MS * 4);
    expect(calls.endRoom).toBe(1);
    expect(calls.rollupEndedRoom).toBe(1);
  });

  it("names the room, the try and the wait in the log", async () => {
    await joinAndLeave();
    failing.set("endRoom", Infinity);
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    await h.advance(RETRY_BASE_MS);
    expect(
      logged(`ending room ${roomId} failed (try 1), trying again in ${RETRY_BASE_MS} ms`),
    ).toBe(true);
    expect(
      logged(`ending room ${roomId} failed (try 2), trying again in ${2 * RETRY_BASE_MS} ms`),
    ).toBe(true);
  });

  it("still sends everyone home when an admin ends a room and the writes fail", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    const watcher = await h.connectAs(cy);
    failing.set("closePresence", Infinity);
    failing.set("endRoom", Infinity);

    expect(await h.hub.endRoomByAdmin(roomId)).toBe(true);
    for (const client of [a, b]) {
      expect((await client.waitForEvent("ended")).event).toEqual({
        kind: "ended",
        reason: "admin",
      });
    }
    expect(await watcher.waitFor("lobby.changed", (m) => m.room?.change === "ended")).toBeDefined();
    expect((await roomRow()).endedAt).toBeNull();

    failing.clear();
    await h.advance(RETRY_BASE_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: null, endedAt: T0, rolledUp: true });
  });

  it("stops retrying when the hub stops", async () => {
    await joinAndLeave();
    failing.set("endRoom", Infinity);
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(calls.endRoom).toBe(1);

    h.hub.stop();
    expect(logged("stopping with 1 room end(s)")).toBe(true);
    await h.advance(RETRY_MAX_MS * 4);
    expect(calls.endRoom).toBe(1);
  });

  it("stops the hub when the realtime server closes", async () => {
    const stop = vi.spyOn(h.hub, "stop");
    await h.restart();
    expect(stop).toHaveBeenCalled();
  });
});

describe("restart recovery when the database is down", () => {
  it("retries with a backoff, refuses joins meanwhile, then restores the room", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    failing.set("loadLiveRooms", Infinity);
    calls = {};
    await h.restart({ downFor: 5 * SECOND });
    expect(calls.loadLiveRooms).toBe(1);
    expect(logged("restart recovery failed")).toBe(true);

    // Until it succeeds a join would open the room without the people it held.
    const a2 = await h.connectAs(ana);
    a2.send({ type: "room.join", roomId });
    expect(await a2.waitFor("error")).toMatchObject({ code: "internal", re: "room.join" });

    await h.advance(RETRY_BASE_MS - 1);
    expect(calls.loadLiveRooms).toBe(1);
    await h.advance(1);
    expect(calls.loadLiveRooms).toBe(2);
    await h.advance(2 * RETRY_BASE_MS);
    expect(calls.loadLiveRooms).toBe(3);

    failing.delete("loadLiveRooms");
    await h.advance(4 * RETRY_BASE_MS);
    expect(calls.loadLiveRooms).toBe(4);

    // ana is back within her reconnect grace: the restored room has her, on her old interval.
    const snapshot = await a2.join(roomId);
    expect(snapshot.participants.map((p) => [p.username, p.role, p.joinedAt])).toEqual([
      ["ana", "host", T0],
    ]);
    await h.advance(RETRY_MAX_MS * 2);
    expect(calls.loadLiveRooms).toBe(4);
  });

  it("gives the restored room its timers: nobody returns, so it ends at the last-seen time", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    failing.set("loadLiveRooms", 3);
    calls = {};
    await h.restart({ downFor: 5 * SECOND });
    for (const wait of [1, 2, 4]) await h.advance(wait * SECOND); // the fourth try succeeds
    expect(calls.loadLiveRooms).toBe(4);

    await h.advance(RECONNECT_GRACE_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: T0, endedAt: null, rolledUp: false });
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: T0, endedAt: T0, rolledUp: true });
  });

  it("refuses a knock too until it has succeeded", async () => {
    const secret = await h.createRoom(ana, { isPrivate: true });
    const [row] = await h.db
      .select({ token: rooms.inviteToken })
      .from(rooms)
      .where(eq(rooms.id, secret));
    failing.set("loadLiveRooms", Infinity);
    await h.restart();

    const b = await h.connectAs(bo);
    b.send({ type: "knock.request", inviteToken: row?.token ?? "" });
    expect(await b.waitFor("error")).toMatchObject({ code: "internal", re: "knock.request" });

    failing.delete("loadLiveRooms");
    await h.advance(RETRY_BASE_MS);
    b.send({ type: "knock.request", inviteToken: row?.token ?? "" });
    expect(await b.waitFor("knock.status")).toMatchObject({ status: "waiting_for_host" });
  });

  it("stops retrying when the hub stops", async () => {
    failing.set("loadLiveRooms", Infinity);
    calls = {};
    await h.restart();
    expect(calls.loadLiveRooms).toBe(1);
    h.hub.stop();
    await h.advance(RETRY_MAX_MS * 4);
    expect(calls.loadLiveRooms).toBe(1);
  });
});
