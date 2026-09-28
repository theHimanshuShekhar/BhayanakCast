import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { presenceIntervals, roomMembers, rooms, streamIntervals } from "../db/schema/index.ts";
import { type ClientMessage, MEDIA_OFF } from "../lib/realtime.ts";
import { ROOM_NAME_MAX } from "../lib/rooms.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";
import { RECONNECT_GRACE_MS } from "./room-hub.ts";

// Moderation (#32, ADR 15): kick, stop share, promote/demote and rename.

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

/** Each user connected and in `room`, in order; each has seen everyone after them arrive. */
async function inRoom<const U extends TestUser[]>(
  users: U,
  room = roomId,
): Promise<{ [K in keyof U]: TestClient }> {
  const clients: TestClient[] = [];
  for (const user of users) {
    const client = await h.connectAs(user);
    await client.join(room);
    for (const earlier of clients) await earlier.waitForEvent("joined");
    clients.push(client);
  }
  return clients as { [K in keyof U]: TestClient };
}

/** Send `message` from `client` and return the refusal it gets. */
async function refused(client: TestClient, message: ClientMessage) {
  client.send(message);
  return client.waitFor("error", (e) => e.re === message.type);
}

async function memberRow(userId: string, room = roomId) {
  const [row] = await h.db
    .select({ role: roomMembers.role, kicked: roomMembers.kicked })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, room), eq(roomMembers.userId, userId)));
  return row ?? null;
}

async function presenceOf(userId: string) {
  const rows = await h.db
    .select({ startedAt: presenceIntervals.startedAt, endedAt: presenceIntervals.endedAt })
    .from(presenceIntervals)
    .where(and(eq(presenceIntervals.roomId, roomId), eq(presenceIntervals.userId, userId)))
    .orderBy(asc(presenceIntervals.startedAt));
  return rows.map((r) => [r.startedAt.toISOString(), r.endedAt?.toISOString() ?? null]);
}

const feedKinds = (client: TestClient) =>
  client.received.flatMap((m) => (m.type === "feed.entry" ? [m.entry] : []));

describe("mod.kick", () => {
  it("removes the target at once, tells them and everyone, and blocks their rejoin", async () => {
    const [a, b, c] = await inRoom([ana, bo, cy]);
    await h.advance(10 * SECOND);
    a.send({ type: "mod.kick", userId: bo.id });

    expect(await b.waitFor("error")).toEqual({
      type: "error",
      code: "kicked",
      message: "You were removed from this room",
    });
    for (const client of [a, c]) {
      expect(await client.waitForEvent("kicked")).toMatchObject({
        at: t(10),
        event: { kind: "kicked", userId: bo.id, by: { userId: ana.id, username: "ana" } },
      });
    }
    await h.settled();
    for (const client of [a, b, c]) expect(client.pending()).toEqual([]);
    expect(feedKinds(c).at(-1)).toMatchObject({
      kind: "kicked",
      userId: bo.id,
      username: "bo",
      by: { userId: ana.id, username: "ana" },
    });
    // Out now, no reconnect grace; kicked for good.
    expect(await presenceOf(bo.id)).toEqual([[t(0), t(10)]]);
    expect(await memberRow(bo.id)).toEqual({ role: "member", kicked: true });

    // The connection stays open (for the lobby) but out of the room.
    expect(await refused(b, { type: "chat.send", text: "hi" })).toMatchObject({
      code: "forbidden",
    });
    expect(await refused(b, { type: "room.join", roomId })).toMatchObject({ code: "kicked" });
    const again = await h.connectAs(bo);
    expect(await refused(again, { type: "room.join", roomId })).toMatchObject({
      code: "kicked",
    });
    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(await presenceOf(bo.id)).toEqual([[t(0), t(10)]]);
  });

  it("removes someone in their reconnect grace as of when their socket closed", async () => {
    const [a, b] = await inRoom([ana, bo]);
    await h.advance(5 * SECOND);
    await b.close();
    await h.settled();
    await h.advance(10 * SECOND);
    a.send({ type: "mod.kick", userId: bo.id });
    await a.waitForEvent("kicked");
    expect(await presenceOf(bo.id)).toEqual([[t(0), t(5)]]);
    // Their grace timer doesn't fire a later "left".
    await h.advance(RECONNECT_GRACE_MS);
    await h.settled();
    expect(a.pending()).toEqual([]);
  });

  it("is for the host and mods, each only on people below them", async () => {
    const [a, b, c] = await inRoom([ana, bo, cy]);
    // A member can't kick.
    expect(await refused(c, { type: "mod.kick", userId: bo.id })).toMatchObject({
      code: "forbidden",
    });
    a.send({ type: "mod.setRole", userId: bo.id, role: "mod" });
    await b.waitForEvent("roleChanged");
    await c.waitForEvent("roleChanged");
    await a.waitForEvent("roleChanged");
    // A mod can't kick the host, nobody kicks themselves, and missing targets aren't found.
    expect(await refused(b, { type: "mod.kick", userId: ana.id })).toMatchObject({
      code: "forbidden",
    });
    expect(await refused(a, { type: "mod.kick", userId: ana.id })).toMatchObject({
      code: "bad_request",
    });
    expect(await refused(a, { type: "mod.kick", userId: "nobody" })).toMatchObject({
      code: "not_found",
    });
    // A mod can kick a member.
    b.send({ type: "mod.kick", userId: cy.id });
    expect(await c.waitFor("error")).toMatchObject({ code: "kicked" });
    expect(await a.waitForEvent("kicked")).toMatchObject({
      event: { userId: cy.id, by: { username: "bo" } },
    });
    await b.waitForEvent("kicked");
    await h.settled();
    for (const client of [a, b]) expect(client.pending()).toEqual([]);
  });

  it("refuses sockets that aren't in the room", async () => {
    const [, b] = await inRoom([ana, bo]);
    const outsider = await h.connectAs(cy);
    expect(await refused(outsider, { type: "mod.kick", userId: bo.id })).toMatchObject({
      code: "forbidden",
    });
    await h.settled();
    expect(b.pending()).toEqual([]);
  });
});

describe("mod.stopShare", () => {
  async function streamRows() {
    const rows = await h.db
      .select({ startedAt: streamIntervals.startedAt, endedAt: streamIntervals.endedAt })
      .from(streamIntervals)
      .where(eq(streamIntervals.roomId, roomId));
    return rows.map((r) => [r.startedAt.toISOString(), r.endedAt?.toISOString() ?? null]);
  }

  it("ends the share for everyone, the streamer included, and closes its interval", async () => {
    const [a, b, c] = await inRoom([ana, bo, cy]);
    b.send({ type: "media.state", ...MEDIA_OFF, mic: true, share: true });
    for (const client of [a, b, c]) await client.waitForEvent("stateChanged");
    await h.advance(20 * SECOND);

    // A member can't; nor can anyone stop a share that isn't on.
    expect(await refused(c, { type: "mod.stopShare", userId: bo.id })).toMatchObject({
      code: "forbidden",
    });
    expect(await refused(a, { type: "mod.stopShare", userId: cy.id })).toMatchObject({
      code: "bad_request",
    });

    a.send({ type: "mod.stopShare", userId: bo.id });
    for (const client of [a, b, c]) {
      expect(await client.waitForEvent("stateChanged")).toMatchObject({
        at: t(20),
        event: {
          userId: bo.id,
          media: { mic: true, cam: false, share: false },
          by: { userId: ana.id, username: "ana" },
        },
      });
    }
    await h.settled();
    for (const client of [a, b, c]) expect(client.pending()).toEqual([]);
    expect(await streamRows()).toEqual([[t(0), t(20)]]);
    expect(feedKinds(a).at(-1)).toMatchObject({
      kind: "shareStopped",
      userId: bo.id,
      by: { username: "ana" },
    });
    // They stay in the room.
    expect(await presenceOf(bo.id)).toEqual([[t(0), null]]);
  });

  it("is open to mods too", async () => {
    const [a, b, c] = await inRoom([ana, bo, cy]);
    a.send({ type: "mod.setRole", userId: bo.id, role: "mod" });
    await c.waitForEvent("roleChanged");
    c.send({ type: "media.state", ...MEDIA_OFF, share: true });
    await c.waitForEvent("stateChanged");
    b.send({ type: "mod.stopShare", userId: cy.id });
    expect(await c.waitForEvent("stateChanged")).toMatchObject({
      event: { media: { share: false }, by: { username: "bo" } },
    });
  });
});

describe("mod.setRole", () => {
  it("promotes and demotes, persists the role and tells everyone", async () => {
    const [a, b, c] = await inRoom([ana, bo, cy]);
    await h.advance(3 * SECOND);
    a.send({ type: "mod.setRole", userId: bo.id, role: "mod" });
    for (const client of [a, b, c]) {
      expect(await client.waitForEvent("roleChanged")).toMatchObject({
        at: t(3),
        event: { kind: "roleChanged", userId: bo.id, role: "mod" },
      });
    }
    expect(await memberRow(bo.id)).toEqual({ role: "mod", kicked: false });
    expect(feedKinds(c).at(-1)).toMatchObject({
      kind: "roleChanged",
      userId: bo.id,
      role: "mod",
      by: { username: "ana" },
    });
    // A late joiner sees the role in the snapshot.
    const dee = await h.createUser("dee");
    const d = await h.connectAs(dee);
    const snapshot = await d.join(roomId);
    expect(snapshot.participants.find((p) => p.userId === bo.id)?.role).toBe("mod");
    for (const client of [a, b, c]) await client.waitForEvent("joined");

    // Mods can't change roles; the host's role isn't changed this way.
    expect(await refused(b, { type: "mod.setRole", userId: cy.id, role: "mod" })).toMatchObject({
      code: "forbidden",
    });

    a.send({ type: "mod.setRole", userId: bo.id, role: "member" });
    for (const client of [a, b, c, d]) {
      expect(await client.waitForEvent("roleChanged")).toMatchObject({
        event: { userId: bo.id, role: "member" },
      });
    }
    expect(await memberRow(bo.id)).toEqual({ role: "member", kicked: false });
    await h.settled();
    for (const client of [a, b, c, d]) expect(client.pending()).toEqual([]);
  });
});

describe("room.rename", () => {
  it("renames the room for everyone, in the DB and on the lobby's cards", async () => {
    const [a, b] = await inRoom([ana, bo]);
    // Someone on home, not in the room.
    const c = await h.connectAs(cy);
    a.send({ type: "room.rename", name: "  late night code  " });
    for (const client of [a, b]) {
      expect(await client.waitForEvent("renamed")).toMatchObject({
        event: { kind: "renamed", name: "late night code", by: { username: "ana" } },
      });
    }
    expect(await c.waitFor("lobby.changed", (m) => m.room?.change === "renamed")).toMatchObject({
      room: { roomId, change: "renamed", participantCount: 2 },
    });
    const [row] = await h.db.select({ name: rooms.name }).from(rooms).where(eq(rooms.id, roomId));
    expect(row?.name).toBe("late night code");
    expect((await c.join(roomId)).name).toBe("late night code");
  });

  it("is the host's alone, and names are 1 to 60 characters", async () => {
    const [a, b] = await inRoom([ana, bo]);
    a.send({ type: "mod.setRole", userId: bo.id, role: "mod" });
    await b.waitForEvent("roleChanged");
    await a.waitForEvent("roleChanged");
    expect(await refused(b, { type: "room.rename", name: "mine now" })).toMatchObject({
      code: "forbidden",
    });
    for (const name of ["   ", "x".repeat(ROOM_NAME_MAX + 1)]) {
      expect(await refused(a, { type: "room.rename", name })).toMatchObject({
        code: "bad_request",
      });
    }
    await h.settled();
    for (const client of [a, b]) expect(client.pending()).toEqual([]);
    const [row] = await h.db.select({ name: rooms.name }).from(rooms).where(eq(rooms.id, roomId));
    expect(row?.name).toBe("ana's room");
  });

  it("keeps private rooms off the lobby", async () => {
    const privateRoom = await h.createRoom(ana, { isPrivate: true });
    const [a] = await inRoom([ana], privateRoom);
    const watcher = await h.connectAs(bo);
    a.send({ type: "room.rename", name: "secret" });
    await a.waitForEvent("renamed");
    await h.settled();
    expect(watcher.pendingLobby().filter((m) => "room" in m && m.room)).toEqual([]);
  });
});

describe("admins", () => {
  it("moderate any room they're in, the host included", async () => {
    const root = await h.createUser("root", { admin: true });
    const [a, b, r] = await inRoom([ana, bo, root]);
    // Just a member of this room: the powers are the admin's own.
    const snapshot = r.received.find((m) => m.type === "room.snapshot");
    expect(
      snapshot?.type === "room.snapshot" &&
        snapshot.participants.find((p) => p.userId === root.id)?.role,
    ).toBe("member");

    r.send({ type: "room.rename", name: "renamed by an admin" });
    await b.waitForEvent("renamed");
    r.send({ type: "mod.setRole", userId: bo.id, role: "mod" });
    await b.waitForEvent("roleChanged");

    // Kicking the host hands host on at once (to the mod), with no host grace.
    r.send({ type: "mod.kick", userId: ana.id });
    expect(await a.waitFor("error", (e) => e.code === "kicked")).toBeTruthy();
    expect(await b.waitForEvent("hostChanged")).toMatchObject({
      event: { hostUserId: bo.id, graceUntil: null },
    });
    expect(await b.waitForEvent("kicked")).toMatchObject({ event: { userId: ana.id } });
    expect(await memberRow(ana.id)).toEqual({ role: "member", kicked: true });
    expect(await memberRow(bo.id)).toMatchObject({ role: "host" });

    // Hosts and mods can't act on an admin.
    expect(await refused(b, { type: "mod.kick", userId: root.id })).toMatchObject({
      code: "forbidden",
    });
    await h.settled();
    expect(b.pending()).toEqual([]);
  });
});
