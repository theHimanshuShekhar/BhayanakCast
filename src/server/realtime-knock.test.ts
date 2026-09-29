import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { roomMembers, rooms, user } from "../db/schema/index.ts";
import type { ClientMessage } from "../lib/realtime.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";

// Private rooms (#41, ADR 16): knock with the invite link, and the host or a mod admits.

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

/** `user` connects and knocks; returns their client once the server says they're waiting. */
async function knock(user: TestUser): Promise<TestClient> {
  const client = await h.connectAs(user);
  client.send({ type: "knock.request", inviteToken });
  expect(await client.waitFor("knock.status")).toEqual({
    type: "knock.status",
    roomId,
    status: "waiting",
  });
  return client;
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
    const b = await knock(bo);
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

  it("sends knocks already pending to someone promoted to site admin, who can admit (#45)", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.db
      .insert(roomMembers)
      .values({ roomId, userId: cy.id, role: "member", approved: true });
    const c = await h.connectAs(cy);
    await c.join(roomId);
    const b = await knock(bo);
    await a.waitFor("knock.pending");

    await h.hub.setUserRole(cy.id, "admin");
    expect(await c.waitFor("knock.pending")).toMatchObject({ knock: { userId: bo.id } });
    // The host, an approver already, isn't told again.
    await h.settled();
    expect(a.received.filter((m) => m.type === "knock.pending")).toHaveLength(1);

    c.send({ type: "knock.decide", userId: bo.id, admit: true });
    await b.waitFor("knock.status", (m) => m.status === "approved");
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
