import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hostIntervals,
  presenceIntervals,
  roomMembers,
  rooms,
  streamIntervals,
  userStats,
} from "../db/schema/index.ts";
import type { ServerMessage } from "../lib/realtime.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";
import { EMPTY_ROOM_TIMEOUT_MS, HOST_GRACE_MS, RECONNECT_GRACE_MS } from "./room-hub.ts";

// Room lifecycle (#31, ADR 14): an empty room ends after 5 minutes at the time it became
// empty, closing its intervals and rolling up stats; a join in time keeps it live.

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let roomId: string;

beforeEach(async () => {
  h = await startRealtimeHarness();
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  roomId = await h.createRoom(ana);
});

afterEach(async () => {
  await h.close();
});

const SECOND = 1_000;
const T0 = "2026-09-01T12:00:00.000Z";
/** T0 plus `s` seconds, as an ISO string. */
const t = (s: number) => new Date(Date.parse(T0) + s * SECOND).toISOString();
const nameOf = (userId: string) => [ana, bo].find((u) => u.id === userId)?.username ?? userId;
const iso = (at: Date | null | undefined) => at?.toISOString() ?? null;

async function roomRow(room = roomId) {
  const [row] = await h.db.select().from(rooms).where(eq(rooms.id, room));
  return {
    lastEmptyAt: iso(row?.lastEmptyAt),
    endedAt: iso(row?.endedAt),
    rolledUp: row?.statsRolledUpAt != null,
  };
}

/** [who, startedAt, endedAt] of `table`'s rows in the room, oldest first. */
async function intervals(
  table: typeof presenceIntervals | typeof streamIntervals | typeof hostIntervals,
  room = roomId,
) {
  const rows = await h.db
    .select({ userId: table.userId, startedAt: table.startedAt, endedAt: table.endedAt })
    .from(table)
    .where(eq(table.roomId, room))
    .orderBy(asc(table.startedAt));
  return rows.map((r) => [nameOf(r.userId), iso(r.startedAt), iso(r.endedAt)]);
}

async function statsOf(user: TestUser) {
  const [row] = await h.db.select().from(userStats).where(eq(userStats.userId, user.id));
  return row ?? null;
}

const roomChanges = (client: TestClient) =>
  client
    .pendingLobby()
    .flatMap((m: ServerMessage) => (m.type === "lobby.changed" && m.room ? [m.room] : []));

/** The next lobby room change of `change` that `client` gets. */
async function roomChange(client: TestClient, change: string) {
  const message = await client.waitFor("lobby.changed", (m) => m.room?.change === change);
  return message.room;
}

describe("an empty room", () => {
  it("ends 5 minutes after the last person leaves, at the time they left", async () => {
    const watcher = await h.connectAs(bo);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.advance(90 * SECOND);
    a.send({ type: "room.leave" });
    await h.advance(0); // a heartbeat round trip: the server has seen what was sent
    expect(await roomRow()).toEqual({ lastEmptyAt: t(90), endedAt: null, rolledUp: false });

    // Still live (idle) until the very end of the wait.
    await h.advance(EMPTY_ROOM_TIMEOUT_MS - SECOND);
    expect((await roomRow()).endedAt).toBeNull();
    expect(roomChanges(watcher).filter((c) => c.change === "ended")).toEqual([]);

    await h.advance(SECOND);
    expect(await roomRow()).toEqual({ lastEmptyAt: t(90), endedAt: t(90), rolledUp: true });
    expect(await intervals(presenceIntervals)).toEqual([["ana", T0, t(90)]]);
    expect(await intervals(hostIntervals)).toEqual([["ana", T0, t(90)]]);
    expect(await statsOf(ana)).toMatchObject({
      roomsJoined: 1,
      roomsHosted: 1,
      secondsWatched: 90,
    });
    // The lobby hears it, so Live Now and Past Streams refresh.
    expect(await roomChange(watcher, "ended")).toEqual({
      roomId,
      change: "ended",
      participantCount: 0,
    });

    // It's a past stream: nobody can join it any more.
    a.send({ type: "room.join", roomId });
    expect(await a.waitFor("error")).toMatchObject({ code: "not_found", re: "room.join" });
  });

  it("ends at the disconnect when the last person's reconnect grace runs out", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.advance(10 * SECOND);
    await a.close();
    await h.advance(RECONNECT_GRACE_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: t(10), endedAt: null, rolledUp: false });
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: t(10), endedAt: t(10), rolledUp: true });
    expect(await intervals(presenceIntervals)).toEqual([["ana", T0, t(10)]]);
  });

  it("ends when the last person actually left, not when an earlier one's grace ran out", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await h.advance(5 * SECOND);
    await a.close(); // ana is gone from 5s, but stays in the room for her grace…
    await h.advance(10 * SECOND);
    b.send({ type: "room.leave" }); // …while bo leaves at 15s…
    await h.advance(RECONNECT_GRACE_MS); // …and the room empties at 35s.
    expect((await roomRow()).lastEmptyAt).toBe(t(15));
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect((await roomRow()).endedAt).toBe(t(15));
  });

  it("ends before a host who took over while away never came back", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await h.advance(0);
    a.send({ type: "room.leave" }); // host grace until 30s
    await h.advance(10 * SECOND);
    await b.close(); // bo is gone from 10s, in his reconnect grace until 40s…
    await h.advance(20 * SECOND); // …and gets host at 30s,
    await h.advance(10 * SECOND); // then leaves, as of 10s.
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect((await roomRow()).endedAt).toBe(t(10));
    expect(await intervals(hostIntervals)).toEqual([
      ["ana", T0, t(30)],
      ["bo", t(30), t(30)],
    ]);
  });

  it("ends normally after a kick and a rename", async () => {
    const watcher = await h.connectAs(bo);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");
    await h.advance(5 * SECOND);
    a.send({ type: "mod.kick", userId: bo.id });
    await a.waitForEvent("kicked");
    a.send({ type: "room.rename", name: "renamed hang" });
    await a.waitForEvent("renamed");
    await h.advance(5 * SECOND);
    a.send({ type: "room.leave" });
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: t(10), endedAt: t(10), rolledUp: true });
    expect((await intervals(presenceIntervals)).sort()).toEqual([
      ["ana", T0, t(10)],
      ["bo", T0, t(5)],
    ]);
    expect(await roomChange(watcher, "ended")).toEqual({
      roomId,
      change: "ended",
      participantCount: 0,
    });
  });

  it("closes an open stream interval at the end time and counts it", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    a.send({ type: "media.state", mic: false, cam: false, share: true });
    await a.waitForEvent("stateChanged");
    await h.advance(20 * SECOND);
    a.send({ type: "room.leave" });
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(await intervals(streamIntervals)).toEqual([["ana", T0, t(20)]]);
    expect(await statsOf(ana)).toMatchObject({ secondsStreamed: 20, secondsWatched: 0 });
  });

  it("keeps going when someone joins in time, and the joiner becomes host", async () => {
    const watcher = await h.connectAs(bo);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.advance(10 * SECOND);
    a.send({ type: "room.leave" });
    await h.advance(4 * 60 * SECOND);

    const b = await h.connectAs(bo);
    const snapshot = await b.join(roomId);
    expect(snapshot.hostUserId).toBe(bo.id);
    expect(snapshot.participants.map((p) => [p.username, p.role])).toEqual([["bo", "host"]]);
    expect(await roomRow()).toEqual({ lastEmptyAt: null, endedAt: null, rolledUp: false });
    // Room cards show the new host.
    expect(await roomChange(watcher, "host")).toEqual({
      roomId,
      change: "host",
      participantCount: 1,
    });

    await h.advance(2 * EMPTY_ROOM_TIMEOUT_MS);
    expect((await roomRow()).endedAt).toBeNull();
    expect((await b.join(roomId)).participants.map((p) => p.username)).toEqual(["bo"]);
  });

  it("starts a fresh wait when it empties again", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    a.send({ type: "room.leave" });
    await h.advance(4 * 60 * SECOND);
    await a.join(roomId);
    await h.advance(60 * SECOND);
    a.send({ type: "room.leave" });
    await h.advance(EMPTY_ROOM_TIMEOUT_MS - SECOND);
    expect((await roomRow()).endedAt).toBeNull();
    await h.advance(SECOND);
    expect((await roomRow()).endedAt).toBe(t(300));
  });

  it("keeps a private room's end out of the lobby", async () => {
    const secret = await h.createRoom(ana, { isPrivate: true });
    const watcher = await h.connectAs(bo);
    const a = await h.connectAs(ana);
    await a.join(secret);
    a.send({ type: "room.leave" });
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect((await roomRow(secret)).endedAt).toBe(T0);
    expect(roomChanges(watcher).filter((c) => c.roomId === secret)).toEqual([]);
  });
});

describe("a room nobody enters", () => {
  it("is empty from its creation, and ends 5 minutes later at that time", async () => {
    const watcher = await h.connectAs(bo);
    expect((await roomRow()).lastEmptyAt).toBe(T0);
    await h.advance(EMPTY_ROOM_TIMEOUT_MS - SECOND);
    expect((await roomRow()).endedAt).toBeNull();
    await h.advance(SECOND);
    expect(await roomRow()).toEqual({ lastEmptyAt: T0, endedAt: T0, rolledUp: true });
    expect(await roomChange(watcher, "ended")).toEqual({
      roomId,
      change: "ended",
      participantCount: 0,
    });
    const a = await h.connectAs(ana);
    a.send({ type: "room.join", roomId });
    expect((await a.waitFor("error")).code).toBe("not_found");
  });

  it("stays live once someone enters in time", async () => {
    await h.advance(4 * 60 * SECOND);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    expect((await roomRow()).lastEmptyAt).toBeNull();
    await h.advance(2 * EMPTY_ROOM_TIMEOUT_MS);
    expect((await roomRow()).endedAt).toBeNull();
  });

  it("private or not", async () => {
    const secret = await h.createRoom(ana, { isPrivate: true });
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect((await roomRow(secret)).endedAt).toBe(T0);
  });
});

describe("host changes reach the lobby", () => {
  it("on handover, but not when the creator first takes host", async () => {
    const watcher = await h.connectAs(bo);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await h.advance(0); // a heartbeat round trip: the server has seen what was sent
    expect(roomChanges(watcher).filter((c) => c.change === "host")).toEqual([]);

    a.send({ type: "room.leave" });
    await h.advance(HOST_GRACE_MS);
    expect(await b.waitForEvent("hostChanged", (m) => m.event.hostUserId === bo.id)).toBeTruthy();
    expect(await roomChange(watcher, "host")).toEqual({
      roomId,
      change: "host",
      participantCount: 1,
    });
  });

  it("never for a private room", async () => {
    const secret = await h.createRoom(ana, { isPrivate: true });
    await h.db.insert(roomMembers).values({ roomId: secret, userId: bo.id, approved: true });
    const watcher = await h.connectAs(bo);
    const a = await h.connectAs(ana);
    await a.join(secret);
    a.send({ type: "room.leave" });
    await h.advance(0); // a heartbeat round trip: the server has seen what was sent
    const b = await h.connectAs(bo);
    expect((await b.join(secret)).hostUserId).toBe(bo.id);
    await h.advance(0); // a heartbeat round trip: the server has seen what was sent
    expect(roomChanges(watcher).filter((c) => c.roomId === secret)).toEqual([]);
  });
});

describe("after a restart", () => {
  it("a room whose people never return ends at their last-seen time", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.advance(70 * SECOND); // one checkpoint, at 60s
    await h.restart({ downFor: 5 * SECOND });

    await h.advance(RECONNECT_GRACE_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: t(60), endedAt: null, rolledUp: false });
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: t(60), endedAt: t(60), rolledUp: true });
    expect(await intervals(presenceIntervals)).toEqual([["ana", T0, t(60)]]);
    expect(await intervals(hostIntervals)).toEqual([["ana", T0, t(60)]]);
  });

  it("a room that was already empty ends 5 minutes after boot, when it became empty", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.advance(10 * SECOND);
    a.send({ type: "room.leave" });
    await h.advance(2 * 60 * SECOND);
    await h.restart({ downFor: 60 * SECOND });

    await h.advance(EMPTY_ROOM_TIMEOUT_MS - SECOND);
    expect((await roomRow()).endedAt).toBeNull();
    await h.advance(SECOND);
    expect(await roomRow()).toEqual({ lastEmptyAt: t(10), endedAt: t(10), rolledUp: true });
  });

  it("a room nobody ever entered ends at its creation", async () => {
    const [created] = await h.db
      .update(rooms)
      .set({ createdAt: new Date(T0) })
      .where(eq(rooms.id, roomId))
      .returning({ createdAt: rooms.createdAt });
    expect(iso(created?.createdAt)).toBe(T0);
    await h.restart({ downFor: 30 * SECOND });
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: T0, endedAt: T0, rolledUp: true });
  });

  it("a room someone returns to in time stays live", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    a.send({ type: "room.leave" });
    await h.advance(0); // a heartbeat round trip: the server has seen what was sent
    await h.restart({ downFor: 60 * SECOND });
    await h.advance(4 * 60 * SECOND);
    const b = await h.connectAs(bo);
    expect((await b.join(roomId)).hostUserId).toBe(bo.id);
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(await roomRow()).toEqual({ lastEmptyAt: null, endedAt: null, rolledUp: false });
  });
});
