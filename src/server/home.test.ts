import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import {
  presenceIntervals,
  roomMembers,
  rooms,
  streamIntervals,
  user,
  userCotime,
  userStats,
} from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import type { Caller } from "./caller.ts";
import { getHomeSummary, getYouCard } from "./home.ts";
import { createRoom } from "./rooms.ts";

let db: Db;
let close: () => Promise<void>;

const visitor: Caller = { user: null, role: "visitor" };
const asUser = (id: string): Caller => ({ user: { id, username: id, image: null }, role: "user" });
const admin: Caller = { user: { id: "admin", username: "admin", image: null }, role: "admin" };
const host = asUser("host");

const HOUR = 3600;
const t = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
const baseInput = { name: "room", kind: "chat" as const, tags: [] };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values(
    ["host", "member", "stranger", "admin", "a", "b"].map((id) => ({
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

describe("getHomeSummary", () => {
  it("returns zeros for an empty platform, except the members", async () => {
    expect(await getHomeSummary(db, visitor)).toEqual({
      rightNow: { liveRooms: 0, inRooms: 0, streaming: 0 },
      community: { members: 6, hoursWatched: 0, hoursStreamed: 0, roomsHosted: 0 },
    });
  });

  describe("right now", () => {
    let publicId: string;
    let privateId: string;

    beforeEach(async () => {
      ({ id: publicId } = await createRoom(db, host, { ...baseInput, name: "public" }));
      ({ id: privateId } = await createRoom(db, host, {
        ...baseInput,
        name: "private",
        isPrivate: true,
      }));
      const { id: endedId } = await createRoom(db, host, { ...baseInput, name: "ended" });
      await db
        .update(rooms)
        .set({ endedAt: t(1) })
        .where(eq(rooms.id, endedId));
      await db
        .insert(roomMembers)
        .values({ roomId: privateId, userId: "member", role: "member", approved: true });

      await db.insert(presenceIntervals).values([
        { roomId: publicId, userId: "host", startedAt: t(30), lastSeenAt: t(0) },
        { roomId: publicId, userId: "a", startedAt: t(20), lastSeenAt: t(0) },
        // Left already: not counted.
        { roomId: publicId, userId: "b", startedAt: t(25), endedAt: t(10), lastSeenAt: t(10) },
        { roomId: privateId, userId: "member", startedAt: t(20), lastSeenAt: t(0) },
        { roomId: privateId, userId: "b", startedAt: t(15), lastSeenAt: t(0) },
        // An ended room's leftover open interval: not counted.
        { roomId: endedId, userId: "stranger", startedAt: t(40), lastSeenAt: t(1) },
      ]);
      await db.insert(streamIntervals).values([
        { roomId: publicId, userId: "host", startedAt: t(15), lastSeenAt: t(0) },
        { roomId: publicId, userId: "a", startedAt: t(19), endedAt: t(18), lastSeenAt: t(18) },
        { roomId: privateId, userId: "member", startedAt: t(10), lastSeenAt: t(0) },
        { roomId: endedId, userId: "stranger", startedAt: t(40), lastSeenAt: t(1) },
      ]);
    });

    it("counts live public rooms and their open intervals for visitors", async () => {
      expect((await getHomeSummary(db, visitor)).rightNow).toEqual({
        liveRooms: 1,
        inRooms: 2,
        streaming: 1,
      });
    });

    it("excludes private rooms for users who aren't members", async () => {
      expect((await getHomeSummary(db, asUser("stranger"))).rightNow).toEqual({
        liveRooms: 1,
        inRooms: 2,
        streaming: 1,
      });
    });

    it("includes private rooms for their members and admins", async () => {
      const everything = { liveRooms: 2, inRooms: 4, streaming: 2 };
      expect((await getHomeSummary(db, asUser("member"))).rightNow).toEqual(everything);
      expect((await getHomeSummary(db, admin)).rightNow).toEqual(everything);
    });
  });

  it("sums lifetime stats into community totals, in hours", async () => {
    await db.insert(userStats).values([
      {
        userId: "a",
        secondsWatched: 10 * HOUR,
        secondsStreamed: 1.5 * HOUR,
        roomsHosted: 3,
        roomsJoined: 9,
      },
      { userId: "b", secondsWatched: 2.5 * HOUR, secondsStreamed: 0, roomsHosted: 1 },
    ]);
    // A room in progress counts as hosted, private or not, the same for every caller.
    await createRoom(db, host, { ...baseInput, isPrivate: true });

    const expected = { members: 6, hoursWatched: 12.5, hoursStreamed: 1.5, roomsHosted: 5 };
    expect((await getHomeSummary(db, visitor)).community).toEqual(expected);
    expect((await getHomeSummary(db, admin)).community).toEqual(expected);
  });

  it("adds the time of a room in progress to the community hours", async () => {
    await db.insert(userStats).values({ userId: "a", secondsWatched: 2 * HOUR });
    const { id } = await createRoom(db, host, baseInput);
    // One clock reading, so the spans below have exact lengths.
    const clock = Date.now();
    const ago = (minutes: number) => new Date(clock - minutes * 60_000);
    await db.insert(presenceIntervals).values([
      { roomId: id, userId: "host", startedAt: ago(90), lastSeenAt: ago(30) },
      { roomId: id, userId: "b", startedAt: ago(60), lastSeenAt: ago(0) },
    ]);
    await db
      .insert(streamIntervals)
      .values({ roomId: id, userId: "host", startedAt: ago(90), lastSeenAt: ago(30) });

    // Live: host streamed 1 h (and watched none); b watched 1 h.
    expect((await getHomeSummary(db, visitor)).community).toMatchObject({
      hoursStreamed: 1,
      hoursWatched: 3,
      roomsHosted: 1,
    });
  });
});

describe("getYouCard", () => {
  const me = asUser("a");
  const together = async (x: string, y: string, seconds: number, publicSeconds = seconds) => {
    const [userA, userB] = x < y ? [x, y] : [y, x];
    await db
      .insert(userCotime)
      .values({ userA, userB, secondsTogether: seconds, publicSecondsTogether: publicSeconds });
  };

  it("gives a visitor nothing", async () => {
    await db.insert(userStats).values({ userId: "a", secondsWatched: HOUR });
    expect(await getYouCard(db, visitor)).toBeNull();
  });

  it("is empty for a user with no time in any room", async () => {
    expect(await getYouCard(db, me)).toEqual({
      hoursWatched: 0,
      hoursStreamed: 0,
      roomsJoined: 0,
      topCoUser: null,
    });
  });

  it("shows the stats without a co-user when nobody shared time", async () => {
    await db
      .insert(userStats)
      .values({ userId: "a", secondsWatched: 3 * HOUR, secondsStreamed: HOUR / 2, roomsJoined: 4 });
    expect(await getYouCard(db, me)).toEqual({
      hoursWatched: 3,
      hoursStreamed: 0.5,
      roomsJoined: 4,
      topCoUser: null,
    });
  });

  it("counts every room, private ones included, and the stored figures with the live ones", async () => {
    // Rolled up from a private room: the public columns stay at zero, as a profile would show.
    await db.insert(userStats).values({
      userId: "a",
      secondsWatched: 2 * HOUR,
      roomsJoined: 1,
      publicSecondsWatched: 0,
      publicRoomsJoined: 0,
    });
    await together("a", "stranger", 4 * HOUR, 0);

    // And a private room in progress: a for an hour, b for the last half hour of it.
    const { id } = await createRoom(db, host, { ...baseInput, isPrivate: true });
    const clock = Date.now();
    const ago = (minutes: number) => new Date(clock - minutes * 60_000);
    await db.insert(presenceIntervals).values([
      { roomId: id, userId: "a", startedAt: ago(60), lastSeenAt: ago(0) },
      { roomId: id, userId: "b", startedAt: ago(30), lastSeenAt: ago(0) },
    ]);

    expect(await getYouCard(db, me)).toEqual({
      hoursWatched: 3,
      hoursStreamed: 0,
      roomsJoined: 2,
      topCoUser: { id: "stranger", username: "stranger", image: null, secondsTogether: 4 * HOUR },
    });
  });

  it("names the co-user with the most time together on either side of the pair", async () => {
    await together("a", "host", HOUR);
    await together("b", "a", 2 * HOUR);
    await together("stranger", "member", 9 * HOUR);
    expect((await getYouCard(db, me))?.topCoUser).toMatchObject({
      id: "b",
      secondsTogether: 2 * HOUR,
    });
  });

  it("breaks a tie by the lowest user id, whatever the insertion order", async () => {
    await together("a", "stranger", HOUR);
    await together("a", "host", HOUR);
    await together("a", "member", HOUR);
    expect((await getYouCard(db, me))?.topCoUser?.id).toBe("host");
  });

  it("only ever reads the caller's own figures", async () => {
    await db.insert(userStats).values([
      { userId: "a", secondsWatched: HOUR },
      { userId: "b", secondsWatched: 7 * HOUR },
    ]);
    await together("b", "host", 5 * HOUR);
    expect(await getYouCard(db, me)).toMatchObject({ hoursWatched: 1, topCoUser: null });
  });
});
