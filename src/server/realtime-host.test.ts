import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostIntervals, roomMembers, rooms } from "../db/schema/index.ts";
import { type RealtimeHarness, startRealtimeHarness, type TestUser } from "./realtime-harness.ts";

// Host lifecycle (#30, ADRs 11 and 14): host intervals, the 30s host grace, and handover.

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
const nameOf = (userId: string | null) =>
  [ana, bo, cy].find((u) => u.id === userId)?.username ?? userId;

/** The room's host intervals, oldest first, as [who, startedAt, endedAt]. */
async function hostRows() {
  const rows = await h.db
    .select()
    .from(hostIntervals)
    .where(eq(hostIntervals.roomId, roomId))
    .orderBy(asc(hostIntervals.startedAt));
  return rows.map((r) => [
    nameOf(r.userId),
    r.startedAt.toISOString(),
    r.endedAt?.toISOString() ?? null,
  ]);
}

/** `rooms.hostUserId` and the non-member `room_members` roles, by name. */
async function storedRoles() {
  const [room] = await h.db
    .select({ hostUserId: rooms.hostUserId })
    .from(rooms)
    .where(eq(rooms.id, roomId));
  const members = await h.db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId));
  return {
    host: nameOf(room?.hostUserId ?? null),
    roles: Object.fromEntries(
      members
        .map((m) => [nameOf(m.userId), m.role])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ),
  };
}

/** Who's in the room per `snapshot`, as [name, role]. */
const roster = (snapshot: { participants: { username: string; role: string }[] }) =>
  snapshot.participants.map((p) => [p.username, p.role]);

/** ana (host) at T0, bo at 1s and cy at 2s, everyone having seen everyone arrive. */
async function threeInRoom() {
  const a = await h.connectAs(ana);
  await a.join(roomId);
  await h.advance(1 * SECOND);
  const b = await h.connectAs(bo);
  await b.join(roomId);
  await a.waitForEvent("joined");
  await h.advance(1 * SECOND);
  const c = await h.connectAs(cy);
  await c.join(roomId);
  await a.waitForEvent("joined");
  await b.waitForEvent("joined");
  return { a, b, c };
}

describe("host intervals", () => {
  it("open when the creator first enters, not when the room is created", async () => {
    await h.advance(5 * SECOND);
    expect(await hostRows()).toEqual([]);
    const a = await h.connectAs(ana);
    const snapshot = await a.join(roomId);
    expect(snapshot.hostUserId).toBe(ana.id);
    expect(snapshot.hostGraceUntil).toBeUndefined();
    expect(roster(snapshot)).toEqual([["ana", "host"]]);
    expect(await hostRows()).toEqual([["ana", t(5), null]]);

    // Coming and going (the room never empties meanwhile) keeps the one interval.
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.close();
    await h.advance(10 * SECOND);
    const again = await h.connectAs(ana);
    await again.join(roomId);
    await h.settled();
    expect(await hostRows()).toEqual([["ana", t(5), null]]);
  });
});

describe("host grace", () => {
  it("keeps host for a host who reconnects within 30s", async () => {
    const { a, b, c } = await threeInRoom();
    await h.advance(8 * SECOND);
    await a.close();
    for (const client of [b, c]) {
      expect(await client.waitForEvent("hostChanged")).toEqual({
        type: "room.event",
        roomId,
        at: t(10),
        event: { kind: "hostChanged", hostUserId: ana.id, graceUntil: t(40) },
      });
    }

    // A joiner during the grace learns of it from the snapshot.
    await h.advance(20 * SECOND);
    const d = await h.connectAs(await h.createUser("di"));
    expect((await d.join(roomId)).hostGraceUntil).toBe(t(40));
    await b.waitForEvent("joined");
    await c.waitForEvent("joined");

    await h.advance(9 * SECOND);
    const back = await h.connectAs(ana);
    const snapshot = await back.join(roomId);
    expect(snapshot.hostGraceUntil).toBeUndefined();
    expect(roster(snapshot)).toEqual([
      ["ana", "host"],
      ["bo", "member"],
      ["cy", "member"],
      ["di", "member"],
    ]);
    for (const client of [b, c, d]) {
      expect((await client.waitForEvent("hostChanged")).event).toEqual({
        kind: "hostChanged",
        hostUserId: ana.id,
        graceUntil: null,
      });
    }

    // Long past when the grace would have run out: nothing changes hands.
    await h.advance(60 * SECOND);
    for (const client of [back, b, c, d]) expect(client.pending()).toEqual([]);
    expect(await hostRows()).toEqual([["ana", T0, null]]);
    expect(await storedRoles()).toEqual({ host: "ana", roles: { ana: "host" } });
  });

  it("starts on an explicit leave too, and a rejoin within it keeps host", async () => {
    const { a, b } = await threeInRoom();
    a.send({ type: "room.leave" });
    expect((await b.waitForEvent("left")).event).toEqual({ kind: "left", userId: ana.id });
    expect((await b.waitForEvent("hostChanged")).event).toEqual({
      kind: "hostChanged",
      hostUserId: ana.id,
      graceUntil: t(32),
    });

    await h.advance(15 * SECOND);
    expect(roster(await a.join(roomId))).toEqual([
      ["bo", "member"],
      ["cy", "member"],
      ["ana", "host"],
    ]);
    expect((await b.waitForEvent("joined")).event).toMatchObject({
      participant: { userId: ana.id, role: "host" },
    });
    expect((await b.waitForEvent("hostChanged")).event).toMatchObject({
      hostUserId: ana.id,
      graceUntil: null,
    });
    await h.advance(30 * SECOND);
    expect(b.pending()).toEqual([]);
    expect(await hostRows()).toEqual([["ana", T0, null]]);
  });
});

describe("handover", () => {
  it("passes host to the longest-present member once the grace runs out", async () => {
    const { a, b, c } = await threeInRoom();
    await h.advance(8 * SECOND);
    a.send({ type: "room.leave" });
    for (const client of [b, c]) {
      await client.waitForEvent("left");
      await client.waitForEvent("hostChanged");
    }

    await h.advance(30 * SECOND);
    for (const client of [b, c]) {
      expect(await client.waitForEvent("hostChanged")).toEqual({
        type: "room.event",
        roomId,
        at: t(40),
        event: { kind: "hostChanged", hostUserId: bo.id, graceUntil: null },
      });
      expect(client.pending()).toEqual([]);
    }
    expect(await hostRows()).toEqual([
      ["ana", T0, t(40)],
      ["bo", t(40), null],
    ]);
    expect(await storedRoles()).toEqual({ host: "bo", roles: { ana: "member", bo: "host" } });

    // The old host coming back later is a member; host stays with bo.
    const snapshot = await a.join(roomId);
    expect(snapshot.hostUserId).toBe(bo.id);
    expect(roster(snapshot)).toEqual([
      ["bo", "host"],
      ["cy", "member"],
      ["ana", "member"],
    ]);
    await h.advance(60 * SECOND);
    expect(await hostRows()).toEqual([
      ["ana", T0, t(40)],
      ["bo", t(40), null],
    ]);
  });

  it("prefers a mod over members who have been there longer", async () => {
    await h.db.insert(roomMembers).values({ roomId, userId: cy.id, role: "mod" });
    const { a, b, c } = await threeInRoom();
    await a.close();
    await b.waitForEvent("hostChanged");
    await h.advance(30 * SECOND);
    expect((await b.waitForEvent("hostChanged")).event).toEqual({
      kind: "hostChanged",
      hostUserId: cy.id,
      graceUntil: null,
    });
    await c.waitForEvent("hostChanged");
    expect((await c.waitForEvent("hostChanged")).event.hostUserId).toBe(cy.id);
    // ana's reconnect grace ran out at the same moment.
    expect((await b.waitForEvent("left")).event.userId).toBe(ana.id);
    expect(await storedRoles()).toEqual({ host: "cy", roles: { ana: "member", cy: "host" } });
    expect(await hostRows()).toEqual([
      ["ana", T0, t(32)],
      ["cy", t(32), null],
    ]);

    // Chat shows the new roles.
    b.send({ type: "chat.send", text: "hi" });
    expect((await c.waitFor("chat.message")).message).toMatchObject({
      username: "bo",
      role: "member",
    });
    const later = await h.connectAs(await h.createUser("di"));
    expect(roster(await later.join(roomId))).toEqual([
      ["bo", "member"],
      ["cy", "host"],
      ["di", "member"],
    ]);
  });

  it("skips people in their reconnect grace while someone connected is there", async () => {
    const { a, b } = await threeInRoom();
    await a.close();
    await h.advance(5 * SECOND);
    // bo (here longer than cy) is still in his reconnect grace when ana's host grace runs out.
    await b.close();
    await h.advance(25 * SECOND);
    expect(await storedRoles()).toMatchObject({ host: "cy" });
  });
});

describe("empty rooms", () => {
  it("make whoever joins next the host", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.advance(10 * SECOND);
    a.send({ type: "room.leave" });
    await h.advance(20 * SECOND);

    const b = await h.connectAs(bo);
    const snapshot = await b.join(roomId);
    expect(snapshot.hostUserId).toBe(bo.id);
    expect(snapshot.hostGraceUntil).toBeUndefined();
    expect(roster(snapshot)).toEqual([["bo", "host"]]);
    expect(await hostRows()).toEqual([
      ["ana", T0, t(30)],
      ["bo", t(30), null],
    ]);
    expect(await storedRoles()).toEqual({ host: "bo", roles: { ana: "member", bo: "host" } });

    // ana is back as a member.
    const again = await h.connectAs(ana);
    expect(roster(await again.join(roomId))).toEqual([
      ["bo", "host"],
      ["ana", "member"],
    ]);
    await h.advance(60 * SECOND);
    expect(
      b.pending().filter((m) => m.type === "room.event" && m.event.kind === "hostChanged"),
    ).toEqual([]);
  });

  it("don't include one whose lone host is in their reconnect grace: a joiner waits it out", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await a.close();
    await h.advance(10 * SECOND);
    // bo arrives while ana may still come back: the grace is running, so bo waits for it.
    const b = await h.connectAs(bo);
    const snapshot = await b.join(roomId);
    expect(snapshot.hostUserId).toBe(ana.id);
    expect(snapshot.hostGraceUntil).toBe(t(30));
    await h.advance(20 * SECOND);
    expect((await b.waitForEvent("left")).event.userId).toBe(ana.id);
    expect((await b.waitForEvent("hostChanged")).event).toEqual({
      kind: "hostChanged",
      hostUserId: bo.id,
      graceUntil: null,
    });
    expect(await hostRows()).toEqual([
      ["ana", T0, t(30)],
      ["bo", t(30), null],
    ]);
  });
});

describe("a new room someone else enters before its creator", () => {
  it("stays the creator's through the host grace, and they keep host by coming in", async () => {
    await h.advance(5 * SECOND);
    const b = await h.connectAs(bo);
    const snapshot = await b.join(roomId);
    expect(snapshot.hostUserId).toBe(ana.id);
    expect(snapshot.hostGraceUntil).toBe(t(35));
    expect(roster(snapshot)).toEqual([["bo", "member"]]);
    expect(await hostRows()).toEqual([]);

    // ana was still in the pre-join lobby; she comes in within the grace.
    await h.advance(20 * SECOND);
    const a = await h.connectAs(ana);
    expect(roster(await a.join(roomId))).toEqual([
      ["bo", "member"],
      ["ana", "host"],
    ]);
    expect((await b.waitForEvent("hostChanged")).event).toEqual({
      kind: "hostChanged",
      hostUserId: ana.id,
      graceUntil: null,
    });
    await h.advance(60 * SECOND);
    expect(await hostRows()).toEqual([["ana", t(25), null]]);
    expect(await storedRoles()).toEqual({ host: "ana", roles: { ana: "host" } });
  });

  it("passes host to them once the grace runs out without the creator", async () => {
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await h.advance(30 * SECOND);
    expect((await b.waitForEvent("hostChanged")).event).toEqual({
      kind: "hostChanged",
      hostUserId: bo.id,
      graceUntil: null,
    });
    expect(await hostRows()).toEqual([["bo", t(30), null]]);
    expect(await storedRoles()).toEqual({ host: "bo", roles: { ana: "member", bo: "host" } });

    // The creator arriving later is a member.
    const a = await h.connectAs(ana);
    expect(roster(await a.join(roomId))).toEqual([
      ["bo", "host"],
      ["ana", "member"],
    ]);
  });

  it("is settled by whoever comes next if the first visitor leaves before the creator", async () => {
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await h.advance(10 * SECOND);
    b.send({ type: "room.leave" });
    await h.advance(30 * SECOND);
    // Once someone has been in it, the usual rule: whoever joins an empty room is host.
    const c = await h.connectAs(cy);
    const snapshot = await c.join(roomId);
    expect(snapshot.hostUserId).toBe(cy.id);
    expect(snapshot.hostGraceUntil).toBeUndefined();
    expect(await hostRows()).toEqual([["cy", t(40), null]]);
  });

  it("follows the same rule after a restart", async () => {
    await h.restart({ downFor: 5 * SECOND });
    const b = await h.connectAs(bo);
    const snapshot = await b.join(roomId);
    expect(snapshot.hostUserId).toBe(ana.id);
    expect(snapshot.hostGraceUntil).toBe(t(35));
    await h.advance(30 * SECOND);
    expect((await b.waitForEvent("hostChanged")).event.hostUserId).toBe(bo.id);
  });
});

describe("restart", () => {
  it("keeps host for a host who is back within the grace, with the same interval", async () => {
    await threeInRoom();
    await h.advance(60 * SECOND);
    await h.restart({ downFor: 5 * SECOND });

    const b = await h.connectAs(bo);
    const snapshot = await b.join(roomId);
    expect(snapshot.hostUserId).toBe(ana.id);
    expect(snapshot.hostGraceUntil).toBe(t(97));

    await h.advance(10 * SECOND);
    const a2 = await h.connectAs(ana);
    expect(roster(await a2.join(roomId))[0]).toEqual(["ana", "host"]);
    expect((await b.waitForEvent("hostChanged")).event.graceUntil).toBeNull();
    await h.advance(60 * SECOND);
    expect(await hostRows()).toEqual([["ana", T0, null]]);
    expect(await storedRoles()).toMatchObject({ host: "ana" });
  });

  it("hands host on after the grace when the host never returns", async () => {
    await threeInRoom();
    await h.advance(60 * SECOND);
    await h.restart({ downFor: 5 * SECOND });

    const c = await h.connectAs(cy);
    await c.join(roomId);
    await h.advance(30 * SECOND);
    expect((await c.waitForEvent("hostChanged")).event).toEqual({
      kind: "hostChanged",
      hostUserId: cy.id,
      graceUntil: null,
    });
    expect(await hostRows()).toEqual([
      ["ana", T0, t(97)],
      ["cy", t(97), null],
    ]);
    expect(await storedRoles()).toEqual({ host: "cy", roles: { ana: "member", cy: "host" } });
  });
});
