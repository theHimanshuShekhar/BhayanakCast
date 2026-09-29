import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { roomMembers, rooms, user } from "../db/schema/index.ts";
import { ROOM_CAPACITY } from "../lib/format.ts";
import { type ClientMessage, KNOCK_EXPIRY_MS } from "../lib/realtime.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";
import { EMPTY_ROOM_TIMEOUT_MS, HOST_GRACE_MS, RECONNECT_GRACE_MS } from "./room-hub.ts";

// Private rooms (#41, #42, ADR 16): knock with the invite link, and the host or a mod admits
// or denies; a knock also ends when withdrawn, when its socket closes, or after 10 minutes.

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let cy: TestUser;
let roomId: string;
let inviteToken: string;

const T0 = "2026-09-01T12:00:00.000Z";

beforeEach(async () => {
  h = await startRealtimeHarness();
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  cy = await h.createUser("cy");
  roomId = await h.createRoom(ana, { name: "ana's secret", isPrivate: true });
  inviteToken = await tokenOf(roomId);
});

afterEach(async () => {
  await h.close();
});

async function tokenOf(id: string): Promise<string> {
  const [row] = await h.db
    .select({ inviteToken: rooms.inviteToken })
    .from(rooms)
    .where(eq(rooms.id, id));
  if (!row?.inviteToken) throw new Error("Room has no invite token");
  return row.inviteToken;
}

async function approvedRow(userId: string) {
  const [row] = await h.db
    .select({ approved: roomMembers.approved })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)));
  return row?.approved ?? null;
}

/** Send `message` from `client` and return the refusal it gets. */
async function refused(client: TestClient, message: ClientMessage) {
  client.send(message);
  return client.waitFor("error", (e) => e.re === message.type);
}

/**
 * `user` connects and knocks; returns their client once the server says they're waiting
 * (`waiting_for_host` if nobody who can admit them is here).
 */
async function knock(
  user: TestUser,
  status: "waiting" | "waiting_for_host" = "waiting",
): Promise<TestClient> {
  const client = await h.connectAs(user);
  client.send({ type: "knock.request", inviteToken });
  expect(await client.waitFor("knock.status")).toEqual({ type: "knock.status", roomId, status });
  return client;
}

/** An approved member of the room (let in by an earlier knock). */
async function approve(userId: string) {
  await h.db.insert(roomMembers).values({ roomId, userId, role: "member", approved: true });
}

describe("knock and admit", () => {
  it("knock → the host sees it pending → admit → the knocker joins", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await knock(bo);

    expect(await a.waitFor("knock.pending")).toEqual({
      type: "knock.pending",
      roomId,
      knock: { userId: bo.id, username: "bo", at: T0 },
    });
    expect(await approvedRow(bo.id)).toBeNull();

    a.send({ type: "knock.decide", userId: bo.id, admit: true });
    expect(await b.waitFor("knock.status")).toEqual({
      type: "knock.status",
      roomId,
      status: "approved",
    });
    expect(await a.waitFor("knock.resolved")).toEqual({
      type: "knock.resolved",
      roomId,
      userId: bo.id,
    });
    expect(await approvedRow(bo.id)).toBe(true);

    const snapshot = await b.join(roomId);
    expect(snapshot.participants.map((p) => p.userId)).toEqual([ana.id, bo.id]);
    await a.waitForEvent("joined");
    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(b.pending()).toEqual([]);
  });

  it("keeps the approval until the room ends, so a rejoin needs no new knock", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await knock(bo);
    await a.waitFor("knock.pending");
    a.send({ type: "knock.decide", userId: bo.id, admit: true });
    await b.waitFor("knock.status", (m) => m.status === "approved");
    await b.join(roomId);
    await b.close();

    const again = await h.connectAs(bo);
    expect((await again.join(roomId)).participants.map((p) => p.userId)).toContain(bo.id);
  });

  it("tells mods too, and lets a mod admit", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    // cy is approved and made a mod; bo is the one knocking.
    await h.db
      .insert(roomMembers)
      .values({ roomId, userId: cy.id, role: "member", approved: true });
    const c = await h.connectAs(cy);
    await c.join(roomId);
    await a.waitForEvent("joined");
    a.send({ type: "mod.setRole", userId: cy.id, role: "mod" });
    await c.waitForEvent("roleChanged");

    const b = await knock(bo);
    await a.waitFor("knock.pending");
    await c.waitFor("knock.pending");
    c.send({ type: "knock.decide", userId: bo.id, admit: true });
    await b.waitFor("knock.status", (m) => m.status === "approved");
    // Every approver hears it was handled.
    await a.waitFor("knock.resolved");
    await c.waitFor("knock.resolved");
    await b.join(roomId);
  });

  it("sends knocks already pending to a host who joins later, who can admit", async () => {
    const b = await knock(bo, "waiting_for_host");
    const a = await h.connectAs(ana);
    await a.join(roomId);
    expect(await a.waitFor("knock.pending")).toMatchObject({ knock: { userId: bo.id } });
    a.send({ type: "knock.decide", userId: bo.id, admit: true });
    await b.waitFor("knock.status", (m) => m.status === "approved");
    await b.join(roomId);
  });

  it("sends knocks already pending to someone made mod", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.db
      .insert(roomMembers)
      .values({ roomId, userId: cy.id, role: "member", approved: true });
    const c = await h.connectAs(cy);
    await c.join(roomId);
    await knock(bo);
    await a.waitFor("knock.pending");

    a.send({ type: "mod.setRole", userId: cy.id, role: "mod" });
    await c.waitForEvent("roleChanged");
    expect(await c.waitFor("knock.pending")).toMatchObject({ knock: { userId: bo.id } });
  });

  it("keeps the knock pending if the approval can't be stored", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await knock(bo);
    await a.waitFor("knock.pending");
    // bo's account is gone, so storing the approval fails.
    await h.db.delete(user).where(eq(user.id, bo.id));
    expect(await refused(a, { type: "knock.decide", userId: bo.id, admit: true })).toMatchObject({
      code: "internal",
    });
    // Still pending: a repeated join (a resync) lists it again.
    a.send({ type: "room.join", roomId });
    await a.waitFor("room.snapshot");
    expect(await a.waitFor("knock.pending")).toMatchObject({ knock: { userId: bo.id } });
    await h.settled();
    expect(b.pending()).toEqual([]);
  });

  it("answers someone already allowed in (the host) as approved at once", async () => {
    const a = await h.connectAs(ana);
    a.send({ type: "knock.request", inviteToken });
    expect(await a.waitFor("knock.status")).toEqual({
      type: "knock.status",
      roomId,
      status: "approved",
    });
    await h.settled();
    expect(a.pending()).toEqual([]);
  });

  it("denies: the knocker is told and stays out", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await knock(bo);
    await a.waitFor("knock.pending");
    a.send({ type: "knock.decide", userId: bo.id, admit: false });
    expect(await b.waitFor("knock.status")).toMatchObject({ status: "denied" });
    await a.waitFor("knock.resolved");
    expect(await approvedRow(bo.id)).toBeNull();
    expect(await refused(b, { type: "room.join", roomId })).toMatchObject({ code: "forbidden" });
  });
});

describe("refusals", () => {
  it("refuses a non-approved direct join of a private room with forbidden", async () => {
    const b = await h.connectAs(bo);
    expect(await refused(b, { type: "room.join", roomId })).toMatchObject({
      code: "forbidden",
      re: "room.join",
    });
    // Knocking alone doesn't let them in either.
    b.send({ type: "knock.request", inviteToken });
    await b.waitFor("knock.status");
    expect(await refused(b, { type: "room.join", roomId })).toMatchObject({ code: "forbidden" });
  });

  it("refuses an unknown token, and a public room's token, with not_found", async () => {
    const publicRoom = await h.createRoom(ana);
    const b = await h.connectAs(bo);
    for (const token of ["no-such-token", await tokenOf(publicRoom)]) {
      expect(await refused(b, { type: "knock.request", inviteToken: token })).toMatchObject({
        code: "not_found",
      });
    }
  });

  it("refuses a kicked user's knock with kicked, and never tells the approvers", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.db
      .insert(roomMembers)
      .values({ roomId, userId: bo.id, role: "member", approved: true });
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");
    a.send({ type: "mod.kick", userId: bo.id });
    await a.waitForEvent("kicked");

    const again = await h.connectAs(bo);
    expect(await refused(again, { type: "knock.request", inviteToken })).toMatchObject({
      code: "kicked",
    });
    await h.settled();
    expect(a.pending().filter((m) => m.type.startsWith("knock."))).toEqual([]);
  });

  it("lets only the host, mods and admins decide, and only on a pending knock", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.db
      .insert(roomMembers)
      .values({ roomId, userId: cy.id, role: "member", approved: true });
    const c = await h.connectAs(cy);
    await c.join(roomId);
    await knock(bo);
    await a.waitFor("knock.pending");

    // A plain member gets no knock and can't decide.
    expect(await refused(c, { type: "knock.decide", userId: bo.id, admit: true })).toMatchObject({
      code: "forbidden",
    });
    // Nobody else is knocking.
    expect(await refused(a, { type: "knock.decide", userId: cy.id, admit: true })).toMatchObject({
      code: "not_found",
    });
    await h.settled();
    expect(c.pending()).toEqual([]);
    expect(await approvedRow(bo.id)).toBeNull();
  });

  it("lets an admin in the room decide", async () => {
    const admin = await h.createUser("root", { admin: true });
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const r = await h.connectAs(admin);
    await r.join(roomId);
    const b = await knock(bo);
    await r.waitFor("knock.pending");
    r.send({ type: "knock.decide", userId: bo.id, admit: true });
    await b.waitFor("knock.status", (m) => m.status === "approved");
  });
});

describe("the knock queue (#42)", () => {
  it("expires an undecided knock after 10 minutes, and the knocker can knock again", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await knock(bo);
    await a.waitFor("knock.pending");

    // Knocking again (a reconnect) keeps the knock and its expiry.
    await h.advance(KNOCK_EXPIRY_MS / 2);
    b.send({ type: "knock.request", inviteToken });
    await b.waitFor("knock.status", (m) => m.status === "waiting");
    expect(await a.waitFor("knock.pending")).toMatchObject({ knock: { userId: bo.id, at: T0 } });
    await h.advance(KNOCK_EXPIRY_MS / 2 - 1);
    expect(b.pending()).toEqual([]);
    expect(a.pending()).toEqual([]);

    await h.advance(1);
    expect(await b.waitFor("knock.status")).toEqual({
      type: "knock.status",
      roomId,
      status: "expired",
    });
    expect(await a.waitFor("knock.resolved")).toEqual({
      type: "knock.resolved",
      roomId,
      userId: bo.id,
    });
    // Too late to decide it.
    expect(await refused(a, { type: "knock.decide", userId: bo.id, admit: true })).toMatchObject({
      code: "not_found",
    });

    // A fresh knock, with a fresh 10 minutes.
    b.send({ type: "knock.request", inviteToken });
    await b.waitFor("knock.status", (m) => m.status === "waiting");
    expect(await a.waitFor("knock.pending")).toMatchObject({
      knock: { userId: bo.id, at: new Date(Date.parse(T0) + KNOCK_EXPIRY_MS).toISOString() },
    });
    a.send({ type: "knock.decide", userId: bo.id, admit: true });
    await b.waitFor("knock.status", (m) => m.status === "approved");
  });

  it("keeps the knock across a reconnect within the grace: same time, same expiry", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await knock(bo);
    await a.waitFor("knock.pending");

    await b.close();
    await h.advance(RECONNECT_GRACE_MS - 1);
    // Approvers see no change while the knocker is away.
    expect(a.pending()).toEqual([]);
    const again = await knock(bo);
    expect(await a.waitFor("knock.pending")).toMatchObject({ knock: { userId: bo.id, at: T0 } });
    // The grace timer is gone: nothing happens when it would have run out.
    await h.advance(1);
    expect(a.pending()).toEqual([]);
    expect(again.pending()).toEqual([]);

    // Still the original 10 minutes from T0.
    await h.advance(KNOCK_EXPIRY_MS - RECONNECT_GRACE_MS - 1);
    expect(again.pending()).toEqual([]);
    await h.advance(1);
    expect(await again.waitFor("knock.status")).toMatchObject({ status: "expired" });
    await a.waitFor("knock.resolved");
  });

  it("withdraws the knock once its socket stays gone past the reconnect grace", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await knock(bo);
    await a.waitFor("knock.pending");

    await b.close();
    await h.advance(RECONNECT_GRACE_MS - 1);
    expect(a.pending()).toEqual([]);
    await h.advance(1);
    expect(await a.waitFor("knock.resolved")).toEqual({
      type: "knock.resolved",
      roomId,
      userId: bo.id,
    });
    expect(await refused(a, { type: "knock.decide", userId: bo.id, admit: true })).toMatchObject({
      code: "not_found",
    });
    // Nor does it come back for an approver who resyncs.
    a.send({ type: "room.join", roomId });
    await a.waitFor("room.snapshot");
    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(await approvedRow(bo.id)).toBeNull();
  });

  it("withdraws the knock on knock.cancel (leaving the waiting screen)", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await knock(bo);
    await a.waitFor("knock.pending");

    b.send({ type: "knock.cancel" });
    expect(await a.waitFor("knock.resolved")).toMatchObject({ userId: bo.id });
    await h.settled();
    // The knocker isn't told anything: they left.
    expect(b.pending()).toEqual([]);
    // Nothing pending now: a second cancel does nothing.
    b.send({ type: "knock.cancel" });
    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(b.pending()).toEqual([]);
  });

  it("moves a knock to another tab, telling the first tab, which isn't stranded", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const first = await knock(bo);
    await a.waitFor("knock.pending");
    const second = await knock(bo);
    // The first tab hears the knock is answered elsewhere now.
    expect(await first.waitFor("knock.status")).toEqual({
      type: "knock.status",
      roomId,
      status: "elsewhere",
    });
    expect(await a.waitFor("knock.pending")).toMatchObject({ knock: { userId: bo.id, at: T0 } });

    // A cancel from the first tab no longer touches it.
    first.send({ type: "knock.cancel" });
    await h.settled();
    expect(a.pending()).toEqual([]);

    // The second tab closes; the first knocks again within the grace and takes it back.
    await second.close();
    await h.advance(RECONNECT_GRACE_MS / 2);
    first.send({ type: "knock.request", inviteToken });
    await first.waitFor("knock.status", (m) => m.status === "waiting");
    expect(await a.waitFor("knock.pending")).toMatchObject({ knock: { userId: bo.id, at: T0 } });
    await h.advance(RECONNECT_GRACE_MS);
    expect(a.pending()).toEqual([]);
    a.send({ type: "knock.decide", userId: bo.id, admit: true });
    await first.waitFor("knock.status", (m) => m.status === "approved");
  });

  it("withdraws a knock moved to a tab that then closes, after the grace", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const first = await knock(bo);
    await a.waitFor("knock.pending");
    const second = await knock(bo);
    await first.waitFor("knock.status", (m) => m.status === "elsewhere");
    await a.waitFor("knock.pending");

    await second.close();
    await h.advance(RECONNECT_GRACE_MS);
    expect(await a.waitFor("knock.resolved")).toMatchObject({ userId: bo.id });
    // The first tab was told already, and can knock afresh.
    expect(first.pending()).toEqual([]);
    await knock(bo);
    expect(await a.waitFor("knock.pending")).toMatchObject({
      knock: { at: new Date(Date.parse(T0) + RECONNECT_GRACE_MS).toISOString() },
    });
  });

  it("lets the first of two mods deciding at once win; the other's is a no-op", async () => {
    const dee = await h.createUser("dee");
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const mods: TestClient[] = [];
    for (const mod of [cy, dee]) {
      await approve(mod.id);
      const client = await h.connectAs(mod);
      await client.join(roomId);
      a.send({ type: "mod.setRole", userId: mod.id, role: "mod" });
      await client.waitForEvent("roleChanged", (m) => m.event.userId === mod.id);
      mods.push(client);
    }
    const [c, d] = mods as [TestClient, TestClient];
    const b = await knock(bo);
    await c.waitFor("knock.pending");
    await d.waitFor("knock.pending");

    // Both decide before either hears of the other's decision.
    c.send({ type: "knock.decide", userId: bo.id, admit: true });
    d.send({ type: "knock.decide", userId: bo.id, admit: false });
    const { status } = await b.waitFor("knock.status");
    // The knock is gone for every approver, the host included.
    await a.waitFor("knock.resolved");
    await c.waitFor("knock.resolved");
    await d.waitFor("knock.resolved");
    await h.settled();

    // Exactly one decision was refused, the later one: the knock was gone by then.
    const refusals = (client: TestClient) => client.pending().filter((m) => m.type === "error");
    expect([...refusals(c), ...refusals(d)]).toEqual([
      expect.objectContaining({ type: "error", code: "not_found", re: "knock.decide" }),
    ]);
    const cyWon = refusals(d).length === 1;
    expect(status).toBe(cyWon ? "approved" : "denied");
    expect(await approvedRow(bo.id)).toBe(cyWon ? true : null);
    // The knocker heard one answer only.
    expect(b.pending()).toEqual([]);
  });

  it("says waiting_for_host while no approver is connected, updated as they come and go", async () => {
    await approve(cy.id);
    // Nobody in the room yet (its creator is still in the pre-join lobby).
    const b = await knock(bo, "waiting_for_host");
    // A plain member arriving changes nothing.
    const c = await h.connectAs(cy);
    await c.join(roomId);
    await h.settled();
    expect(b.pending()).toEqual([]);

    // The host arrives.
    const a = await h.connectAs(ana);
    await a.join(roomId);
    expect(await b.waitFor("knock.status")).toEqual({
      type: "knock.status",
      roomId,
      status: "waiting",
    });
    await a.waitFor("knock.pending");

    // The host's socket drops: nobody can answer during their reconnect grace.
    await a.close();
    expect(await b.waitFor("knock.status")).toMatchObject({ status: "waiting_for_host" });
    // After the host grace cy is host, and gets the knock.
    await h.advance(HOST_GRACE_MS);
    await c.waitForEvent("hostChanged", (m) => m.event.hostUserId === cy.id);
    expect(await b.waitFor("knock.status")).toMatchObject({ status: "waiting" });
    expect(await c.waitFor("knock.pending")).toMatchObject({ knock: { userId: bo.id } });

    // The new host leaves: nobody again.
    c.send({ type: "room.leave" });
    expect(await b.waitFor("knock.status")).toMatchObject({ status: "waiting_for_host" });
    await h.settled();
    expect(b.pending()).toEqual([]);
  });

  it("tells a knocker admitted into a full room room_full; they get in once a spot frees", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const guests: TestClient[] = [];
    for (let i = 1; i < ROOM_CAPACITY; i++) {
      const guest = await h.createUser(`guest${i}`);
      await approve(guest.id);
      const g = await h.connectAs(guest);
      await g.join(roomId);
      guests.push(g);
    }
    const b = await knock(bo);
    await a.waitFor("knock.pending");

    a.send({ type: "knock.decide", userId: bo.id, admit: true });
    expect(await b.waitFor("knock.status")).toEqual({
      type: "knock.status",
      roomId,
      status: "room_full",
    });
    await a.waitFor("knock.resolved");
    // Approved all the same, but the cap holds.
    expect(await approvedRow(bo.id)).toBe(true);
    expect(await refused(b, { type: "room.join", roomId })).toMatchObject({ code: "room_full" });

    guests[0]?.send({ type: "room.leave" });
    await a.waitForEvent("left");
    const snapshot = await b.join(roomId);
    expect(snapshot.participants).toHaveLength(ROOM_CAPACITY);
  });

  it("refuses a knock still pending when its room ends: the link opens nothing now", async () => {
    // Nobody ever enters, so the room ends before the knock would expire.
    const b = await knock(bo, "waiting_for_host");
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    expect(await b.waitFor("error")).toMatchObject({ code: "not_found", re: "knock.request" });
    await h.advance(KNOCK_EXPIRY_MS);
    expect(b.pending()).toEqual([]);
  });
});
