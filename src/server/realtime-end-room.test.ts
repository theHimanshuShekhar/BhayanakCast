import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hostIntervals,
  presenceIntervals,
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
import { EMPTY_ROOM_TIMEOUT_MS, RECONNECT_GRACE_MS } from "./room-hub.ts";

// An admin ends a room (#46, ADR 6): everyone in it hears `ended` and is out of it, its
// intervals close now, it ends now and its stats roll up once.

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let cy: TestUser;
let roomId: string;

beforeEach(async () => {
  h = await startRealtimeHarness();
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  cy = await h.createUser("cy");
  roomId = await h.createRoom(ana, { name: "ana's room" });
});

afterEach(async () => {
  await h.close();
});

const SECOND = 1_000;
const T0 = "2026-09-01T12:00:00.000Z";
/** T0 plus `s` seconds, as an ISO string. */
const t = (s: number) => new Date(Date.parse(T0) + s * SECOND).toISOString();
const iso = (at: Date | null | undefined) => at?.toISOString() ?? null;
const nameOf = (userId: string) => [ana, bo, cy].find((u) => u.id === userId)?.username ?? userId;

async function roomRow(room = roomId) {
  const [row] = await h.db.select().from(rooms).where(eq(rooms.id, room));
  return { endedAt: iso(row?.endedAt), rolledUpAt: iso(row?.statsRolledUpAt) };
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

describe("endRoomByAdmin", () => {
  it("tells everyone `ended`, closes their intervals now, ends the room and rolls it up once", async () => {
    const watcher = await h.connectAs(cy);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");
    b.send({ type: "media.state", mic: false, cam: false, share: true });
    await a.waitForEvent("stateChanged");
    await b.waitForEvent("stateChanged");
    await h.advance(90 * SECOND);

    expect(await h.hub.endRoomByAdmin(roomId)).toBe(true);

    for (const client of [a, b]) {
      expect(await client.waitForEvent("ended")).toEqual({
        type: "room.event",
        roomId,
        at: t(90),
        event: { kind: "ended", reason: "admin" },
      });
    }
    await h.settled();
    // Nobody hears anyone leave: the room is simply over. Their sockets stay open.
    expect(a.pending()).toEqual([]);
    expect(b.pending()).toEqual([]);
    expect(a.isClosed || b.isClosed).toBe(false);

    expect(await roomRow()).toEqual({ endedAt: t(90), rolledUpAt: t(90) });
    expect(await intervals(presenceIntervals)).toEqual([
      ["ana", T0, t(90)],
      ["bo", T0, t(90)],
    ]);
    expect(await intervals(streamIntervals)).toEqual([["bo", T0, t(90)]]);
    expect(await intervals(hostIntervals)).toEqual([["ana", T0, t(90)]]);
    expect(await statsOf(ana)).toMatchObject({
      roomsJoined: 1,
      roomsHosted: 1,
      secondsWatched: 90,
    });
    expect(await statsOf(bo)).toMatchObject({
      roomsJoined: 1,
      secondsStreamed: 90,
      secondsWatched: 0,
    });
    // The lobby hears it, so Live Now and Past Streams refresh.
    expect(roomChanges(watcher).filter((c) => c.change === "ended")).toEqual([
      { roomId, change: "ended", participantCount: 0 },
    ]);

    // Ending it again, or its empty-room timer, changes nothing: rolled up exactly once.
    expect(await h.hub.endRoomByAdmin(roomId)).toBe(false);
    await h.advance(EMPTY_ROOM_TIMEOUT_MS + RECONNECT_GRACE_MS);
    expect(a.pending()).toEqual([]);
    expect(await roomRow()).toEqual({ endedAt: t(90), rolledUpAt: t(90) });
    expect(await statsOf(ana)).toMatchObject({
      roomsJoined: 1,
      roomsHosted: 1,
      secondsWatched: 90,
    });

    // A past stream: nobody gets back in, and nothing they send reaches the room.
    a.send({ type: "room.join", roomId });
    expect(await a.waitFor("error")).toMatchObject({ code: "not_found", re: "room.join" });
    b.send({ type: "chat.send", text: "still here?" });
    expect(await b.waitFor("error")).toMatchObject({ code: "forbidden", re: "chat.send" });
  });

  it("closes the presence of someone in their reconnect grace when their socket closed, and tells them on their rejoin", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");
    await h.advance(10 * SECOND);
    await b.close();
    await h.advance(5 * SECOND);

    await h.hub.endRoomByAdmin(roomId);

    expect(await a.waitForEvent("ended")).toMatchObject({ at: t(15) });
    await h.settled();
    expect(await intervals(presenceIntervals)).toEqual([
      ["ana", T0, t(15)],
      ["bo", T0, t(10)],
    ]);

    // Back after the end (the client re-joins on reconnect): told the room was ended, once.
    await h.advance(5 * SECOND);
    const back = await h.connectAs(bo);
    back.send({ type: "room.join", roomId });
    expect(await back.waitForEvent("ended")).toEqual({
      type: "room.event",
      roomId,
      at: t(20),
      event: { kind: "ended", reason: "admin" },
    });
    back.send({ type: "room.join", roomId });
    expect(await back.waitFor("error")).toMatchObject({ code: "not_found", re: "room.join" });
    // Only those who missed it: someone who was here gets the usual refusal.
    a.send({ type: "room.join", roomId });
    expect(await a.waitFor("error")).toMatchObject({ code: "not_found", re: "room.join" });

    // Their grace running out later changes nothing.
    await h.advance(RECONNECT_GRACE_MS);
    expect(a.pending()).toEqual([]);
    expect(back.pending()).toEqual([]);
    expect(await intervals(presenceIntervals)).toEqual([
      ["ana", T0, t(15)],
      ["bo", T0, t(10)],
    ]);
  });

  it("refuses the knocks pending on a private room, and keeps its end out of the lobby", async () => {
    const secret = await h.createRoom(ana, { name: "ana's secret", isPrivate: true });
    const [row] = await h.db
      .select({ inviteToken: rooms.inviteToken })
      .from(rooms)
      .where(eq(rooms.id, secret));
    const watcher = await h.connectAs(cy);
    const a = await h.connectAs(ana);
    await a.join(secret);
    const b = await h.connectAs(bo);
    b.send({ type: "knock.request", inviteToken: row?.inviteToken ?? "" });
    expect(await b.waitFor("knock.status")).toMatchObject({ status: "waiting" });
    await a.waitFor("knock.pending");

    await h.hub.endRoomByAdmin(secret);

    expect(await a.waitForEvent("ended")).toMatchObject({ roomId: secret });
    expect(await b.waitFor("error")).toMatchObject({ code: "not_found", re: "knock.request" });
    await h.settled();
    expect((await roomRow(secret)).endedAt).not.toBeNull();
    expect(roomChanges(watcher).filter((c) => c.roomId === secret)).toEqual([]);
  });

  it("ends a room nobody is in, at once", async () => {
    await h.advance(20 * SECOND);
    await h.hub.endRoomByAdmin(roomId);
    expect(await roomRow()).toEqual({ endedAt: t(20), rolledUpAt: t(20) });
  });

  it("does nothing for an unknown room", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    expect(await h.hub.endRoomByAdmin("no-such-room")).toBe(false);
    await h.settled();
    expect(a.pending()).toEqual([]);
    expect((await roomRow()).endedAt).toBeNull();
  });
});

describe("endRoomByAdmin on a live room the hub doesn't hold", () => {
  /** A live room with an open presence, straight into the database: the hub never loaded it. */
  async function unheldRoom() {
    const [row] = await h.db
      .insert(rooms)
      .values({ name: "seeded", createdBy: ana.id, hostUserId: ana.id, createdAt: new Date(T0) })
      .returning({ id: rooms.id });
    if (!row) throw new Error("No room");
    await h.db.insert(presenceIntervals).values({
      roomId: row.id,
      userId: ana.id,
      startedAt: new Date(T0),
      lastSeenAt: new Date(t(5)),
    });
    return row.id;
  }

  it("ends it in the database on its queue: a join queued behind it is refused", async () => {
    const seeded = await unheldRoom();
    await h.advance(20 * SECOND);
    const b = await h.connectAs(bo);

    const ending = h.hub.endRoomByAdmin(seeded);
    b.send({ type: "room.join", roomId: seeded });

    expect(await ending).toBe(true);
    expect(await b.waitFor("error")).toMatchObject({ code: "not_found", re: "room.join" });
    await h.settled();
    expect(await roomRow(seeded)).toEqual({ endedAt: t(20), rolledUpAt: t(20) });
    // Open intervals close at their last-seen time (ADR 12); nobody's is opened after the end.
    expect(await intervals(presenceIntervals, seeded)).toEqual([["ana", T0, t(5)]]);
    expect(await statsOf(ana)).toMatchObject({ roomsJoined: 1, secondsWatched: 5 });
    // No stale live room is left behind: ending it again finds nothing.
    expect(await h.hub.endRoomByAdmin(seeded)).toBe(false);
  });

  it("sends home someone whose join was queued first, which loaded it", async () => {
    const seeded = await unheldRoom();
    const b = await h.connectAs(bo);
    await b.join(seeded);

    expect(await h.hub.endRoomByAdmin(seeded)).toBe(true);
    expect(await b.waitForEvent("ended")).toMatchObject({ roomId: seeded });
  });
});
