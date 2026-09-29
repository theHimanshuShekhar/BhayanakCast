import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { roomMembers, rooms, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import type { Caller } from "./caller.ts";
import { getInviteToken, regenerateInviteToken, resolveInvite } from "./invites.ts";
import { createRoom, getLiveRoom } from "./rooms.ts";

let db: Db;
let close: () => Promise<void>;

const visitor: Caller = { user: null, role: "visitor" };
const asUser = (id: string): Caller => ({ user: { id, username: id }, role: "user" });
const admin: Caller = { user: { id: "admin", username: "admin" }, role: "admin" };
const host = asUser("host");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values(
    ["host", "mod", "member", "stranger", "admin"].map((id) => ({
      id,
      name: id,
      email: `${id}@discord.invalid`,
      role: id === "admin" ? "admin" : "user",
    })),
  );
});

afterEach(async () => {
  await close();
});

const baseInput = { name: "secret jams", kind: "music" as const, tags: [] };

async function tokenOf(roomId: string): Promise<string> {
  const [row] = await db
    .select({ inviteToken: rooms.inviteToken })
    .from(rooms)
    .where(eq(rooms.id, roomId));
  if (!row?.inviteToken) throw new Error("no token");
  return row.inviteToken;
}

describe("resolveInvite", () => {
  it("resolves a live private room's token to the room", async () => {
    const { id } = await createRoom(db, host, { ...baseInput, isPrivate: true });
    expect(await resolveInvite(db, await tokenOf(id))).toEqual({
      roomId: id,
      name: "secret jams",
    });
  });

  it("resolves nothing for an unknown token, a public room or an ended room", async () => {
    const { id: publicId } = await createRoom(db, host, baseInput);
    const { id: endedId } = await createRoom(db, host, { ...baseInput, isPrivate: true });
    await db.update(rooms).set({ endedAt: new Date() }).where(eq(rooms.id, endedId));
    expect(await resolveInvite(db, "no-such-token")).toBeNull();
    expect(await resolveInvite(db, await tokenOf(publicId))).toBeNull();
    expect(await resolveInvite(db, await tokenOf(endedId))).toBeNull();
  });
});

describe("getInviteToken", () => {
  let roomId: string;

  beforeEach(async () => {
    ({ id: roomId } = await createRoom(db, host, { ...baseInput, isPrivate: true }));
    await db.insert(roomMembers).values([
      { roomId, userId: "mod", role: "mod", approved: true },
      { roomId, userId: "member", role: "member", approved: true },
    ]);
  });

  it("gives the host, mods and admins the invite token", async () => {
    const token = await tokenOf(roomId);
    for (const caller of [host, asUser("mod"), admin]) {
      expect(await getInviteToken(db, caller, roomId)).toBe(token);
    }
  });

  it("gives nobody else a token, nor one for a public room", async () => {
    for (const caller of [visitor, asUser("member"), asUser("stranger")]) {
      expect(await getInviteToken(db, caller, roomId)).toBeNull();
    }
    const { id: publicId } = await createRoom(db, host, baseInput);
    expect(await getInviteToken(db, host, publicId)).toBeNull();
  });

  it("gives a kicked mod nothing", async () => {
    await db.update(roomMembers).set({ kicked: true }).where(eq(roomMembers.userId, "mod"));
    expect(await getInviteToken(db, asUser("mod"), roomId)).toBeNull();
  });
});

describe("regenerateInviteToken", () => {
  let roomId: string;

  beforeEach(async () => {
    ({ id: roomId } = await createRoom(db, host, { ...baseInput, isPrivate: true }));
    await db.insert(roomMembers).values([
      { roomId, userId: "mod", role: "mod", approved: true },
      { roomId, userId: "member", role: "member", approved: true },
    ]);
  });

  it("gives the host a new token: the old one opens nothing, the new one the room", async () => {
    const old = await tokenOf(roomId);
    const fresh = await regenerateInviteToken(db, host, roomId, null);
    expect(fresh).toEqual(expect.any(String));
    expect(fresh).not.toBe(old);
    expect(await tokenOf(roomId)).toBe(fresh);
    expect(await resolveInvite(db, old)).toBeNull();
    expect(await resolveInvite(db, fresh ?? "")).toEqual({ roomId, name: "secret jams" });
  });

  it("leaves approved members able to see the room", async () => {
    await regenerateInviteToken(db, host, roomId, null);
    expect(await getLiveRoom(db, asUser("member"), roomId)).toMatchObject({ id: roomId });
  });

  it("lets nobody but the host regenerate, and changes nothing for them", async () => {
    const token = await tokenOf(roomId);
    for (const caller of [visitor, asUser("mod"), asUser("member"), asUser("stranger"), admin]) {
      expect(await regenerateInviteToken(db, caller, roomId, null)).toBeNull();
    }
    expect(await tokenOf(roomId)).toBe(token);
  });

  it("regenerates nothing for a public or ended room", async () => {
    const { id: publicId } = await createRoom(db, host, baseInput);
    await db.update(rooms).set({ endedAt: new Date() }).where(eq(rooms.id, roomId));
    for (const id of [publicId, roomId]) {
      const token = await tokenOf(id);
      expect(await regenerateInviteToken(db, host, id, null)).toBeNull();
      expect(await tokenOf(id)).toBe(token);
    }
  });
});
