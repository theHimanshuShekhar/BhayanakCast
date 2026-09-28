import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { presenceIntervals, rooms } from "../db/schema/index.ts";
import { MEDIA_OFF, PROTOCOL_VERSION } from "../lib/realtime.ts";
import { type RealtimeHarness, startRealtimeHarness, type TestUser } from "./realtime-harness.ts";

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

const T0 = "2026-09-01T12:00:00.000Z";
const SECOND = 1_000;

/** The room's presence intervals by start, then ana before bo. */
async function presenceRows() {
  const order = (userId: string) => [ana.id, bo.id].indexOf(userId);
  const rows = await h.db
    .select({
      userId: presenceIntervals.userId,
      startedAt: presenceIntervals.startedAt,
      endedAt: presenceIntervals.endedAt,
    })
    .from(presenceIntervals)
    .where(eq(presenceIntervals.roomId, roomId))
    .orderBy(asc(presenceIntervals.startedAt));
  return rows.sort(
    (x, y) => x.startedAt.getTime() - y.startedAt.getTime() || order(x.userId) - order(y.userId),
  );
}

describe("upgrade", () => {
  it("accepts a signed-in user and welcomes them after hello", async () => {
    const a = await h.connect(ana);
    a.send({ type: "hello", v: PROTOCOL_VERSION });
    expect(await a.waitFor("welcome")).toEqual({
      type: "welcome",
      v: PROTOCOL_VERSION,
      user: { id: ana.id, username: "ana" },
    });
  });

  it("takes sockets without a valid session as anonymous (lobby.test.ts)", async () => {
    const forged = await h.connect({ ...ana, cookie: "better-auth.session_token=forged" });
    forged.send({ type: "hello", v: PROTOCOL_VERSION });
    expect(await forged.waitFor("welcome")).toMatchObject({ user: null });
  });

  it("refuses upgrades from another origin", async () => {
    expect(await h.upgradeStatus(ana, { origin: "https://evil.example" })).toBe(403);
  });
});

describe("invalid messages", () => {
  it("answers them with error and keeps serving the socket", async () => {
    const a = await h.connect(ana);
    a.sendRaw("not json");
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request" });
    a.sendRaw(JSON.stringify({ type: "no.such.message" }));
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "no.such.message" });
    a.sendRaw(Buffer.from([1, 2, 3]));
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request" });

    // Everything but hello is refused until the handshake.
    a.send({ type: "room.join", roomId });
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "room.join" });
    a.send({ type: "hello", v: PROTOCOL_VERSION + 1 });
    expect(await a.waitFor("error")).toMatchObject({ code: "unsupported_version", re: "hello" });

    a.send({ type: "hello", v: PROTOCOL_VERSION });
    await a.waitFor("welcome");
    a.sendRaw(JSON.stringify({ type: "room.join", roomId: 42 }));
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "room.join" });
    expect((await a.join(roomId)).participants).toHaveLength(1);
  });

  it("refuses joining an unknown, ended or hidden room with not_found", async () => {
    const privateRoom = await h.createRoom(ana, { isPrivate: true });
    const ended = await h.createRoom(ana);
    await h.db
      .update(rooms)
      .set({ endedAt: new Date(T0) })
      .where(eq(rooms.id, ended));
    const b = await h.connectAs(bo);
    for (const id of ["no-such-room", privateRoom, ended]) {
      b.send({ type: "room.join", roomId: id });
      expect(await b.waitFor("error")).toMatchObject({ code: "not_found", re: "room.join" });
    }
    expect(await presenceRows()).toEqual([]);
  });
});

describe("join and leave", () => {
  it("snapshots the joiner, tells the others, and records presence on the server clock", async () => {
    const a = await h.connectAs(ana);
    expect(await a.join(roomId)).toEqual({
      type: "room.snapshot",
      roomId,
      hostUserId: ana.id,
      participants: [
        { userId: ana.id, username: "ana", role: "host", joinedAt: T0, media: MEDIA_OFF },
      ],
      chat: [],
    });

    await h.advance(10 * SECOND);
    const b = await h.connectAs(bo);
    const snapshot = await b.join(roomId);
    const boJoinedAt = "2026-09-01T12:00:10.000Z";
    expect(snapshot.participants).toEqual([
      { userId: ana.id, username: "ana", role: "host", joinedAt: T0, media: MEDIA_OFF },
      { userId: bo.id, username: "bo", role: "member", joinedAt: boJoinedAt, media: MEDIA_OFF },
    ]);
    expect(await a.waitForEvent("joined")).toEqual({
      type: "room.event",
      roomId,
      at: boJoinedAt,
      event: {
        kind: "joined",
        participant: {
          userId: bo.id,
          username: "bo",
          role: "member",
          joinedAt: boJoinedAt,
          media: MEDIA_OFF,
        },
      },
    });

    expect(await presenceRows()).toEqual([
      { userId: ana.id, startedAt: new Date(T0), endedAt: null },
      { userId: bo.id, startedAt: new Date(boJoinedAt), endedAt: null },
    ]);

    // An explicit leave: everyone else hears it and the interval closes.
    await h.advance(20 * SECOND);
    b.send({ type: "room.leave" });
    expect(await a.waitForEvent("left")).toMatchObject({
      at: "2026-09-01T12:00:30.000Z",
      event: { kind: "left", userId: bo.id },
    });
    await h.settled();
    expect(await presenceRows()).toEqual([
      { userId: ana.id, startedAt: new Date(T0), endedAt: null },
      {
        userId: bo.id,
        startedAt: new Date(boJoinedAt),
        endedAt: new Date("2026-09-01T12:00:30.000Z"),
      },
    ]);
    // The leaver hears nothing about their own leave; nobody got anything extra.
    expect(a.pending()).toEqual([]);
    expect(b.pending()).toEqual([]);
  });

  it("treats a disconnect as leaving at the disconnect, once the 30s grace is over", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");

    await h.advance(60 * SECOND);
    await b.close();
    await h.advance(30 * SECOND);
    expect(await a.waitForEvent("left")).toMatchObject({
      at: "2026-09-01T12:01:00.000Z",
      event: { userId: bo.id },
    });
    await a.close();
    await h.advance(30 * SECOND);
    expect(await presenceRows()).toEqual([
      { userId: ana.id, startedAt: new Date(T0), endedAt: new Date("2026-09-01T12:01:30.000Z") },
      { userId: bo.id, startedAt: new Date(T0), endedAt: new Date("2026-09-01T12:01:00.000Z") },
    ]);
  });

  it("repeats the snapshot for a repeated join without a second interval", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    expect((await a.join(roomId)).participants).toHaveLength(1);
    expect(await presenceRows()).toHaveLength(1);
  });

  it("moves a user who joins another room out of the first", async () => {
    const other = await h.createRoom(bo);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");

    await h.advance(5 * SECOND);
    expect((await b.join(other)).participants.map((p) => [p.userId, p.role])).toEqual([
      [bo.id, "host"],
    ]);
    expect(await a.waitForEvent("left")).toMatchObject({ event: { userId: bo.id } });
    await h.settled();
    expect(await presenceRows()).toEqual([
      { userId: ana.id, startedAt: new Date(T0), endedAt: null },
      { userId: bo.id, startedAt: new Date(T0), endedAt: new Date("2026-09-01T12:00:05.000Z") },
    ]);
  });

  it("closes a presence interval left open (e.g. by a crash) before opening a new one", async () => {
    const lastSeen = new Date("2026-09-01T11:30:00.000Z");
    await h.db.insert(presenceIntervals).values({
      roomId,
      userId: ana.id,
      startedAt: new Date("2026-09-01T11:00:00.000Z"),
      lastSeenAt: lastSeen,
    });
    const a = await h.connectAs(ana);
    await a.join(roomId);
    expect(await presenceRows()).toEqual([
      { userId: ana.id, startedAt: new Date("2026-09-01T11:00:00.000Z"), endedAt: lastSeen },
      { userId: ana.id, startedAt: new Date(T0), endedAt: null },
    ]);
  });
});
