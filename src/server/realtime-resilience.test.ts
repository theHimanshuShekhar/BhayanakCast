import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { presenceIntervals, roomMembers } from "../db/schema/index.ts";
import { IDLE_CLOSE_CODE } from "../lib/realtime.ts";
import { type RealtimeHarness, startRealtimeHarness, type TestUser } from "./realtime-harness.ts";

// Reconnect grace, heartbeats, checkpoints and restart recovery (#25).

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
  roomId = await h.createRoom(ana);
});

afterEach(async () => {
  await h.close();
});

const SECOND = 1_000;
const T0 = "2026-09-01T12:00:00.000Z";
/** T0 plus `s` seconds, as an ISO string. */
const t = (s: number) => new Date(Date.parse(T0) + s * SECOND).toISOString();

/** The room's presence intervals, by start then name. */
async function presenceRows(room = roomId) {
  const name = (userId: string) => [ana, bo, cy].find((u) => u.id === userId)?.username;
  const rows = await h.db
    .select({
      userId: presenceIntervals.userId,
      startedAt: presenceIntervals.startedAt,
      endedAt: presenceIntervals.endedAt,
      lastSeenAt: presenceIntervals.lastSeenAt,
    })
    .from(presenceIntervals)
    .where(eq(presenceIntervals.roomId, room))
    .orderBy(asc(presenceIntervals.startedAt));
  return rows
    .map((row) => ({
      who: name(row.userId),
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      lastSeenAt: row.lastSeenAt.toISOString(),
    }))
    .sort(
      (x, y) => x.startedAt.localeCompare(y.startedAt) || (x.who ?? "").localeCompare(y.who ?? ""),
    );
}

/** ana and bo in the room from T0, each having seen the other arrive. */
async function anaAndBo() {
  const a = await h.connectAs(ana);
  await a.join(roomId);
  const b = await h.connectAs(bo);
  await b.join(roomId);
  await a.waitForEvent("joined");
  return { a, b };
}

describe("reconnect grace", () => {
  it("resumes the same presence interval, with no left/joined, on a return within 30s", async () => {
    const { a, b } = await anaAndBo();
    await h.advance(10 * SECOND);
    await b.close();
    await h.advance(29 * SECOND);

    const again = await h.connectAs(bo);
    const snapshot = await again.join(roomId);
    expect(snapshot.participants.map((p) => [p.username, p.role, p.joinedAt])).toEqual([
      ["ana", "host", T0],
      ["bo", "member", T0],
    ]);

    // Well past where the grace would have run out: still one interval each, still open.
    await h.advance(60 * SECOND);
    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(again.pending()).toEqual([]);
    expect((await presenceRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["ana", T0, null],
      ["bo", T0, null],
    ]);
  });

  it("keeps a user in the room during the grace, then closes the interval at the disconnect", async () => {
    const { a, b } = await anaAndBo();
    await h.advance(10 * SECOND);
    await b.close();

    // A late joiner during the grace still sees bo.
    await h.advance(20 * SECOND);
    const c = await h.connectAs(cy);
    expect((await c.join(roomId)).participants.map((p) => p.username)).toEqual(["ana", "bo", "cy"]);
    await a.waitForEvent("joined");
    await h.settled();
    expect(a.pending()).toEqual([]);

    await h.advance(10 * SECOND);
    for (const client of [a, c]) {
      expect(await client.waitForEvent("left")).toEqual({
        type: "room.event",
        roomId,
        at: t(10),
        event: { kind: "left", userId: bo.id },
      });
    }
    expect((await presenceRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["ana", T0, null],
      ["bo", T0, t(10)],
      ["cy", t(30), null],
    ]);

    // Coming back after the grace is a new arrival with a new interval.
    const again = await h.connectAs(bo);
    await again.join(roomId);
    expect(await a.waitForEvent("joined")).toMatchObject({
      at: t(40),
      event: { participant: { userId: bo.id, joinedAt: t(40) } },
    });
    expect((await presenceRows()).filter((r) => r.who === "bo")).toHaveLength(2);
  });

  it("does not delay an explicit leave", async () => {
    const { a, b } = await anaAndBo();
    await h.advance(5 * SECOND);
    b.send({ type: "room.leave" });
    expect(await a.waitForEvent("left")).toMatchObject({ at: t(5) });
    await b.close();
    await h.advance(30 * SECOND);
    expect(a.pending()).toEqual([]);
  });

  it("ends a presence left in grace elsewhere when the user joins another room", async () => {
    const other = await h.createRoom(cy);
    const { a, b } = await anaAndBo();
    await h.advance(10 * SECOND);
    await b.close();
    await h.advance(5 * SECOND);

    const again = await h.connectAs(bo);
    await again.join(other);
    expect(await a.waitForEvent("left")).toMatchObject({ at: t(10), event: { userId: bo.id } });
    expect((await presenceRows()).map((r) => [r.who, r.endedAt])).toEqual([
      ["ana", null],
      ["bo", t(10)],
    ]);
    await h.advance(30 * SECOND);
    expect(a.pending()).toEqual([]);
  });
});

describe("heartbeat", () => {
  it("answers ping with pong", async () => {
    const a = await h.connectAs(ana, { heartbeat: false });
    a.send({ type: "ping" });
    expect(await a.waitFor("pong")).toEqual({ type: "pong" });
  });

  it("closes a socket silent for 60s, which then gets the reconnect grace", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo, { heartbeat: false });
    await b.join(roomId);
    await a.waitForEvent("joined");

    await h.advance(59 * SECOND);
    expect(b.isClosed).toBe(false);
    await h.advance(1 * SECOND);
    expect(await b.closed()).toBe(IDLE_CLOSE_CODE);

    // ana heartbeats, so she's still here; bo's presence ends when his socket was closed.
    await h.advance(30 * SECOND);
    expect(a.isClosed).toBe(false);
    expect(await a.waitForEvent("left")).toMatchObject({ at: t(60), event: { userId: bo.id } });
    expect((await presenceRows()).map((r) => [r.who, r.endedAt])).toEqual([
      ["ana", null],
      ["bo", t(60)],
    ]);
  });

  it("keeps a heartbeating socket open indefinitely", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.advance(10 * 60 * SECOND);
    expect(a.isClosed).toBe(false);
    expect(a.pending()).toEqual([]);
  });

  it("counts any message, not only ping, as a sign of life", async () => {
    const a = await h.connectAs(ana, { heartbeat: false });
    await h.advance(50 * SECOND);
    await a.join(roomId);
    await h.advance(50 * SECOND);
    expect(a.isClosed).toBe(false);
    await h.advance(10 * SECOND);
    expect(await a.closed()).toBe(IDLE_CLOSE_CODE);
  });
});

describe("last_seen_at checkpoints", () => {
  it("move forward every minute while present, and stop at the disconnect", async () => {
    const { b } = await anaAndBo();
    expect((await presenceRows()).map((r) => r.lastSeenAt)).toEqual([T0, T0]);

    await h.advance(60 * SECOND);
    expect((await presenceRows()).map((r) => r.lastSeenAt)).toEqual([t(60), t(60)]);

    await h.advance(10 * SECOND);
    await b.close();
    await h.settled();
    expect((await presenceRows()).map((r) => [r.who, r.lastSeenAt])).toEqual([
      ["ana", t(60)],
      ["bo", t(70)],
    ]);

    // The next checkpoint moves ana on but not bo, who's in the grace.
    await h.advance(50 * SECOND);
    expect((await presenceRows()).map((r) => [r.who, r.lastSeenAt, r.endedAt])).toEqual([
      ["ana", t(120), null],
      ["bo", t(70), t(70)],
    ]);
  });
});

describe("restart recovery", () => {
  it("reloads rooms and roles; returners keep their interval, the rest close at last seen", async () => {
    await h.db.insert(roomMembers).values({ roomId, userId: bo.id, role: "mod" });
    const clients = [];
    for (const user of [ana, bo, cy]) {
      const client = await h.connectAs(user);
      await client.join(roomId);
      clients.push(client);
      await h.advance(1 * SECOND);
    }
    await h.advance(67 * SECOND); // one checkpoint, at 60s
    expect(clients.every((client) => !client.isClosed)).toBe(true);

    await h.restart({ downFor: 5 * SECOND });

    // ana is back first: the room is as it was, roles included.
    const a2 = await h.connectAs(ana);
    expect((await a2.join(roomId)).participants).toEqual([
      { userId: ana.id, username: "ana", role: "host", joinedAt: T0 },
      { userId: bo.id, username: "bo", role: "mod", joinedAt: t(1) },
      { userId: cy.id, username: "cy", role: "member", joinedAt: t(2) },
    ]);
    await h.advance(10 * SECOND);
    const b2 = await h.connectAs(bo);
    expect((await b2.join(roomId)).participants.find((p) => p.userId === bo.id)).toMatchObject({
      role: "mod",
      joinedAt: t(1),
    });

    // cy never returns: after the grace she leaves at her last checkpoint.
    await h.advance(20 * SECOND);
    for (const client of [a2, b2]) {
      expect(await client.waitForEvent("left")).toMatchObject({
        at: t(60),
        event: { userId: cy.id },
      });
    }
    await h.settled();
    expect(a2.pending()).toEqual([]);
    expect(b2.pending()).toEqual([]);
    expect((await presenceRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["ana", T0, null],
      ["bo", t(1), null],
      ["cy", t(2), t(60)],
    ]);
  });

  it("closes intervals too old to resume at their last seen, and starts new ones", async () => {
    await anaAndBo();
    await h.advance(70 * SECOND);
    await h.restart({ downFor: 10 * 60 * SECOND });
    expect((await presenceRows()).map((r) => [r.who, r.endedAt])).toEqual([
      ["ana", t(60)],
      ["bo", t(60)],
    ]);

    const a = await h.connectAs(ana);
    expect((await a.join(roomId)).participants).toEqual([
      { userId: ana.id, username: "ana", role: "host", joinedAt: t(670) },
    ]);
    expect((await presenceRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["ana", T0, t(60)],
      ["bo", T0, t(60)],
      ["ana", t(670), null],
    ]);
  });

  it("loses chat history with the restart (it's memory only)", async () => {
    const { a } = await anaAndBo();
    a.send({ type: "chat.send", text: "hello" });
    await a.waitFor("chat.message");
    await h.restart({ downFor: 2 * SECOND });
    const a2 = await h.connectAs(ana);
    const snapshot = await a2.join(roomId);
    expect(snapshot.participants.map((p) => p.username).sort()).toEqual(["ana", "bo"]);
    expect(snapshot.chat).toEqual([]);
  });

  it("boots with nothing live", async () => {
    await h.restart();
    const a = await h.connectAs(ana);
    expect((await a.join(roomId)).participants.map((p) => p.userId)).toEqual([ana.id]);
  });
});
