import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import {
  presenceIntervals,
  roomMembers,
  rooms,
  streamIntervals,
  user,
} from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import type { Caller } from "./caller.ts";
import { createRoom, getLiveRoom, listLiveRooms } from "./rooms.ts";

let db: Db;
let close: () => Promise<void>;

const visitor: Caller = { user: null, role: "visitor" };
const asUser = (id: string): Caller => ({ user: { id, username: id }, role: "user" });
const admin: Caller = { user: { id: "admin", username: "admin" }, role: "admin" };
const host = asUser("host");
const member = asUser("member");
const stranger = asUser("stranger");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values(
    ["host", "member", "stranger", "admin", "kicked"].map((id) => ({
      id,
      name: id,
      email: `${id}@discord.invalid`,
      discordUsername: `${id}.discord`,
      role: id === "admin" ? "admin" : "user",
    })),
  );
});

afterEach(async () => {
  await close();
});

const baseInput = { name: "sunday synth jams", kind: "music" as const, tags: [] };

describe("createRoom", () => {
  it("saves the room with the caller as host and a host membership", async () => {
    const { id } = await createRoom(db, host, {
      name: "  sunday synth jams  ",
      kind: "music",
      tags: ["chill", "Music", "chill"],
      description: " bring headphones ",
      isPrivate: true,
    });

    const room = await getLiveRoom(db, host, id);
    expect(room).toMatchObject({
      id,
      name: "sunday synth jams",
      kind: "music",
      tags: ["chill", "music"],
      description: "bring headphones",
      isPrivate: true,
      host: { id: "host", username: "host.discord" },
      capacity: 10,
    });
    const [saved] = await db.select().from(rooms).where(eq(rooms.id, id));
    expect(saved).toMatchObject({ createdBy: "host", hostUserId: "host", endedAt: null });
    expect(await db.select().from(roomMembers).where(eq(roomMembers.roomId, id))).toEqual([
      expect.objectContaining({ userId: "host", role: "host", kicked: false }),
    ]);
  });

  it("defaults the description to empty and the room to public", async () => {
    const { id } = await createRoom(db, host, baseInput);
    expect(await getLiveRoom(db, visitor, id)).toMatchObject({
      description: "",
      isPrivate: false,
    });
  });

  it("refuses visitors", async () => {
    await expect(createRoom(db, visitor, baseInput)).rejects.toThrow(/sign in/i);
    expect(await db.select().from(rooms)).toEqual([]);
  });

  it.each([
    ["an empty name", { name: "" }],
    ["a blank name", { name: "   " }],
    ["a name over 60 characters", { name: "x".repeat(61) }],
    ["an unknown kind", { kind: "cooking" }],
    ["a tag that isn't a lowercase word", { tags: ["two words"] }],
    ["more than 10 tags", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ["a description over 280 characters", { description: "x".repeat(281) }],
    ["a non-boolean isPrivate", { isPrivate: "yes" }],
  ])("rejects %s", async (_, override) => {
    const input = { ...baseInput, ...override } as Parameters<typeof createRoom>[2];
    await expect(createRoom(db, host, input)).rejects.toThrow();
    expect(await db.select().from(rooms)).toEqual([]);
  });

  it("accepts a 60-character name", async () => {
    const { id } = await createRoom(db, host, { ...baseInput, name: "x".repeat(60) });
    expect((await getLiveRoom(db, host, id))?.name).toHaveLength(60);
  });
});

describe("room visibility", () => {
  let publicId: string;
  let privateId: string;

  beforeEach(async () => {
    ({ id: publicId } = await createRoom(db, host, { ...baseInput, name: "public" }));
    ({ id: privateId } = await createRoom(db, host, {
      ...baseInput,
      name: "private",
      isPrivate: true,
    }));
    await db.insert(roomMembers).values([
      { roomId: privateId, userId: "member", role: "member", approved: true },
      { roomId: privateId, userId: "kicked", role: "member", approved: true, kicked: true },
      // A member row without approval (e.g. a pending knock) doesn't reveal the room.
      { roomId: privateId, userId: "stranger", role: "member", approved: false },
    ]);
  });

  const liveNames = async (caller: Caller) =>
    (await listLiveRooms(db, caller)).map((room) => room.name).sort();

  it("shows visitors public rooms only", async () => {
    expect(await liveNames(visitor)).toEqual(["public"]);
    expect(await getLiveRoom(db, visitor, publicId)).toMatchObject({ name: "public" });
    expect(await getLiveRoom(db, visitor, privateId)).toBeNull();
  });

  it("hides a private room from users who aren't approved members", async () => {
    expect(await liveNames(stranger)).toEqual(["public"]);
    expect(await getLiveRoom(db, stranger, privateId)).toBeNull();
    expect(await liveNames(asUser("kicked"))).toEqual(["public"]);
  });

  it("shows a private room to its host and approved members", async () => {
    expect(await liveNames(host)).toEqual(["private", "public"]);
    expect(await liveNames(member)).toEqual(["private", "public"]);
    expect(await getLiveRoom(db, member, privateId)).toMatchObject({ name: "private" });
  });

  it("shows admins every room", async () => {
    expect(await liveNames(admin)).toEqual(["private", "public"]);
    expect(await getLiveRoom(db, admin, privateId)).toMatchObject({ name: "private" });
  });
});

describe("listLiveRooms", () => {
  it("excludes ended rooms, and getLiveRoom treats them as not found", async () => {
    const { id: live } = await createRoom(db, host, { ...baseInput, name: "live" });
    const { id: ended } = await createRoom(db, host, { ...baseInput, name: "ended" });
    await db.update(rooms).set({ endedAt: new Date() }).where(eq(rooms.id, ended));

    expect((await listLiveRooms(db, admin)).map((room) => room.id)).toEqual([live]);
    expect(await getLiveRoom(db, host, ended)).toBeNull();
    expect(await getLiveRoom(db, host, "no-such-room")).toBeNull();
  });

  it("lists newest first with host, capacity, tags and kind", async () => {
    const { id: older } = await createRoom(db, host, { ...baseInput, name: "older" });
    await db
      .update(rooms)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(rooms.id, older));
    const { id: newer } = await createRoom(db, member, {
      name: "newer",
      kind: "code",
      tags: ["rust"],
    });

    expect(await listLiveRooms(db, visitor)).toEqual([
      expect.objectContaining({
        id: newer,
        host: { id: "member", username: "member.discord" },
        capacity: 10,
        kind: "code",
        tags: ["rust"],
      }),
      expect.objectContaining({ id: older }),
    ]);
  });

  it("counts participants and streams from open intervals only", async () => {
    const { id } = await createRoom(db, host, baseInput);
    const t = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    await db.insert(presenceIntervals).values([
      { roomId: id, userId: "host", startedAt: t(30), lastSeenAt: t(0) },
      { roomId: id, userId: "member", startedAt: t(20), lastSeenAt: t(0) },
      // Left already: not counted.
      { roomId: id, userId: "stranger", startedAt: t(25), endedAt: t(10), lastSeenAt: t(10) },
    ]);
    await db.insert(streamIntervals).values([
      { roomId: id, userId: "host", startedAt: t(15), lastSeenAt: t(0) },
      { roomId: id, userId: "member", startedAt: t(19), endedAt: t(18), lastSeenAt: t(18) },
    ]);

    const [room] = await listLiveRooms(db, visitor);
    expect(room).toMatchObject({
      participantCount: 2,
      participants: [
        { id: "host", username: "host.discord" },
        { id: "member", username: "member.discord" },
      ],
      streamCount: 1,
      streamers: [{ id: "host", username: "host.discord" }],
    });
  });

  it("returns an empty room with no participants or streams", async () => {
    await createRoom(db, host, baseInput);
    expect(await listLiveRooms(db, visitor)).toEqual([
      expect.objectContaining({
        participants: [],
        participantCount: 0,
        streamers: [],
        streamCount: 0,
      }),
    ]);
  });
});
