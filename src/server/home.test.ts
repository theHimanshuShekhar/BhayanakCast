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
      regulars: [],
      records: { longestRoom: null, biggestRoom: null, mostViewers: null },
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

  describe("regulars", () => {
    const regulars = async (caller: Caller) => (await getHomeSummary(db, caller)).regulars;

    it("is empty on an empty platform, and for people with no public time", async () => {
      expect(await regulars(visitor)).toEqual([]);
      await db.insert(userStats).values({ userId: "a", publicSecondsWatched: 0 });
      expect(await regulars(visitor)).toEqual([]);
    });

    it("ranks by hours streamed plus watched, most first, ties to the lowest id", async () => {
      await db.insert(userStats).values([
        { userId: "stranger", secondsWatched: HOUR, publicSecondsWatched: HOUR },
        {
          userId: "b",
          secondsWatched: 2 * HOUR,
          secondsStreamed: HOUR,
          publicSecondsWatched: 2 * HOUR,
          publicSecondsStreamed: HOUR,
        },
        { userId: "member", secondsStreamed: 3 * HOUR, publicSecondsStreamed: 3 * HOUR },
        { userId: "a", secondsWatched: 1.5 * HOUR, publicSecondsWatched: 1.5 * HOUR },
      ]);
      expect(await regulars(visitor)).toEqual([
        { id: "b", username: "b", image: null, hours: 3 },
        { id: "member", username: "member", image: null, hours: 3 },
        { id: "a", username: "a", image: null, hours: 1.5 },
        { id: "stranger", username: "stranger", image: null, hours: 1 },
      ]);
    });

    it("lists at most five people", async () => {
      await db
        .insert(user)
        .values(["c", "d"].map((id) => ({ id, name: id, email: `${id}@discord.invalid` })));
      const ids = ["host", "member", "stranger", "a", "b", "c", "d"];
      await db.insert(userStats).values(
        ids.map((userId, i) => ({
          userId,
          secondsWatched: (i + 1) * HOUR,
          publicSecondsWatched: (i + 1) * HOUR,
        })),
      );
      expect((await regulars(visitor)).map((r) => r.id)).toEqual(["d", "c", "b", "a", "stranger"]);
    });

    it("counts public rooms only: nobody with only private time appears, for any caller", async () => {
      await db.insert(userStats).values([
        // Nine hours in private rooms, one in public.
        {
          userId: "a",
          secondsWatched: 10 * HOUR,
          publicSecondsWatched: HOUR,
        },
        // Private rooms only.
        { userId: "b", secondsStreamed: 20 * HOUR, publicSecondsStreamed: 0 },
      ]);
      // A private room in progress with b and the host in it.
      const { id } = await createRoom(db, host, { ...baseInput, isPrivate: true });
      await db.insert(presenceIntervals).values([
        { roomId: id, userId: "b", startedAt: t(120), lastSeenAt: t(0) },
        { roomId: id, userId: "host", startedAt: t(120), lastSeenAt: t(0) },
      ]);
      for (const caller of [visitor, asUser("stranger"), asUser("b"), host, admin]) {
        expect(await regulars(caller)).toEqual([{ id: "a", username: "a", image: null, hours: 1 }]);
      }
    });

    it("counts a public room in progress", async () => {
      const { id } = await createRoom(db, host, baseInput);
      const clock = Date.now();
      const ago = (minutes: number) => new Date(clock - minutes * 60_000);
      await db.insert(presenceIntervals).values({
        roomId: id,
        userId: "b",
        startedAt: ago(120),
        lastSeenAt: ago(0),
      });
      await db.insert(userStats).values({
        userId: "a",
        secondsWatched: HOUR / 2,
        publicSecondsWatched: HOUR / 2,
      });
      expect(await regulars(visitor)).toEqual([
        { id: "b", username: "b", image: null, hours: 2 },
        { id: "a", username: "a", image: null, hours: 0.5 },
      ]);
    });
  });

  describe("records", () => {
    const records = async (caller: Caller = visitor) => (await getHomeSummary(db, caller)).records;
    const DAY = 24 * 60;
    // One clock reading, so every span below has an exact length.
    const clock = Date.now();
    const ago = (minutes: number) => new Date(clock - minutes * 60_000);

    /** An ended room that lasted from `startedAgo` to `endedAgo` (minutes before the clock). */
    async function pastRoom(
      name: string,
      startedAgo: number,
      endedAgo: number,
      isPrivate = false,
    ): Promise<string> {
      const { id } = await createRoom(db, host, { ...baseInput, name, isPrivate });
      await db
        .update(rooms)
        .set({ createdAt: ago(startedAgo), endedAt: ago(endedAgo) })
        .where(eq(rooms.id, id));
      return id;
    }
    const present = (roomId: string, userId: string, from: number, to: number) =>
      db.insert(presenceIntervals).values({
        roomId,
        userId,
        startedAt: ago(from),
        endedAt: ago(to),
        lastSeenAt: ago(to),
      });
    /** `ids` all present from `from` to `to` minutes ago. */
    const together = (roomId: string, ids: string[], from: number, to: number) =>
      Promise.all(ids.map((id) => present(roomId, id, from, to)));

    it("is all null with no rooms and no stats, so the card has nothing to show", async () => {
      expect(await records()).toEqual({ longestRoom: null, biggestRoom: null, mostViewers: null });
      // A room that never had anyone, and a peak of zero, are no data either.
      await pastRoom("empty", 30, 30);
      await db.insert(userStats).values({ userId: "a", publicPeakViewers: 0 });
      expect(await records()).toEqual({ longestRoom: null, biggestRoom: null, mostViewers: null });
    });

    describe("longest room", () => {
      it("is the longest public past stream, by its creation to its end", async () => {
        await pastRoom("short", 60, 30);
        const long = await pastRoom("long", 500, 41);
        await pastRoom("middle", 200, 10);
        // Live rooms don't count.
        await createRoom(db, host, { ...baseInput, name: "live" });
        expect((await records()).longestRoom).toEqual({
          id: long,
          name: "long",
          durationMinutes: 459,
        });
      });

      it("skips a private room that would win, for every caller, admins included", async () => {
        const publicId = await pastRoom("public", 100, 40);
        await pastRoom("secret", 900, 10, true);
        for (const caller of [visitor, host, asUser("stranger"), admin]) {
          expect((await records(caller)).longestRoom).toMatchObject({
            id: publicId,
            name: "public",
          });
        }
      });

      it("skips a room that ended before the 30-day window, but not one still inside it", async () => {
        await pastRoom("expired", 40 * DAY, 31 * DAY);
        const inside = await pastRoom("inside", 29 * DAY + 600, 29 * DAY);
        expect((await records()).longestRoom).toMatchObject({ id: inside, name: "inside" });
      });

      it("breaks a tie by the room that ended last, then the lowest id", async () => {
        await pastRoom("earlier", 100, 40);
        const later = await pastRoom("later", 70, 10);
        expect((await records()).longestRoom?.id).toBe(later);

        const [a, b] = [await pastRoom("twin a", 70, 10), await pastRoom("twin b", 70, 10)];
        await db.delete(rooms).where(eq(rooms.id, later));
        expect((await records()).longestRoom?.id).toBe([a, b].sort()[0]);
      });
    });

    describe("biggest room", () => {
      it("counts people present at once, not total joins", async () => {
        // Three people one after the other: 3 joins, 1 at a time.
        const sequential = await pastRoom("sequential", 300, 100);
        await present(sequential, "a", 300, 250);
        await present(sequential, "b", 250, 200);
        await present(sequential, "member", 200, 150);
        // Two people together: fewer joins, but 2 at once.
        const overlapping = await pastRoom("overlapping", 300, 100);
        await together(overlapping, ["a", "b"], 280, 200);
        expect((await records()).biggestRoom).toEqual({
          id: overlapping,
          name: "overlapping",
          people: 2,
        });
      });

      it("takes the most at one instant when people come and go in waves", async () => {
        const waves = await pastRoom("waves", 300, 100);
        await present(waves, "a", 300, 200);
        await present(waves, "b", 290, 250);
        await present(waves, "member", 260, 220);
        await present(waves, "stranger", 240, 210);
        // 'a', 'member' and 'stranger' are together from 240 to 220; 'b' left at 250.
        await present(waves, "admin", 150, 120);
        expect((await records()).biggestRoom).toMatchObject({ id: waves, people: 3 });
      });

      it("does not count someone who leaves the moment another arrives", async () => {
        const handover = await pastRoom("handover", 300, 100);
        await present(handover, "a", 300, 200);
        await present(handover, "b", 200, 100);
        expect((await records()).biggestRoom).toMatchObject({ id: handover, people: 1 });
      });

      it("counts one person with several intervals once", async () => {
        const rejoin = await pastRoom("rejoin", 300, 100);
        await present(rejoin, "a", 300, 250);
        await present(rejoin, "a", 240, 200);
        await present(rejoin, "b", 260, 230);
        expect((await records()).biggestRoom).toMatchObject({ id: rejoin, people: 2 });
      });

      it("ends an interval left open at its last-seen checkpoint, within the room's end", async () => {
        const open = await pastRoom("open", 300, 100);
        await db.insert(presenceIntervals).values([
          { roomId: open, userId: "a", startedAt: ago(300), lastSeenAt: ago(120) },
          { roomId: open, userId: "b", startedAt: ago(130), lastSeenAt: ago(110) },
          // Seen after the room ended: clamped to its end, so it never meets 'a'.
          { roomId: open, userId: "host", startedAt: ago(105), lastSeenAt: ago(0) },
        ]);
        // 'b' (130..110) meets 'a' (to 120) and, later, 'host' (from 105): never all three.
        expect((await records()).biggestRoom).toMatchObject({ id: open, people: 2 });
      });

      it("skips a private room that would win, for every caller, admins included", async () => {
        const publicId = await pastRoom("public", 300, 100);
        await together(publicId, ["a", "b"], 280, 200);
        const secret = await pastRoom("secret", 300, 100, true);
        await together(secret, ["a", "b", "member", "stranger"], 280, 200);
        for (const caller of [visitor, host, asUser("member"), admin]) {
          expect((await records(caller)).biggestRoom).toMatchObject({ id: publicId, people: 2 });
        }
      });

      it("skips a room that ended before the 30-day window", async () => {
        const expired = await pastRoom("expired", 40 * DAY, 31 * DAY);
        await together(expired, ["a", "b", "member"], 40 * DAY - 10, 31 * DAY + 10);
        const inside = await pastRoom("inside", 29 * DAY + 100, 29 * DAY);
        await together(inside, ["a", "b"], 29 * DAY + 90, 29 * DAY + 10);
        expect((await records()).biggestRoom).toMatchObject({ id: inside, people: 2 });
      });

      it("skips a room still in progress", async () => {
        const { id } = await createRoom(db, host, baseInput);
        await db.insert(presenceIntervals).values(
          ["a", "b"].map((userId) => ({
            roomId: id,
            userId,
            startedAt: ago(20),
            lastSeenAt: ago(0),
          })),
        );
        expect((await records()).biggestRoom).toBeNull();
      });

      it("breaks a tie by the room that ended last, then the lowest id", async () => {
        const earlier = await pastRoom("earlier", 300, 100);
        await together(earlier, ["a", "b"], 280, 200);
        const later = await pastRoom("later", 300, 50);
        await together(later, ["a", "b"], 280, 200);
        expect((await records()).biggestRoom?.id).toBe(later);

        const twin = await pastRoom("twin", 300, 50);
        await together(twin, ["a", "b"], 280, 200);
        await db.delete(rooms).where(eq(rooms.id, earlier));
        expect((await records()).biggestRoom?.id).toBe([later, twin].sort()[0]);
      });
    });

    describe("most viewers on one stream", () => {
      it("names the user with the highest public peak, all time", async () => {
        await db.insert(userStats).values([
          { userId: "a", peakViewers: 9, publicPeakViewers: 9 },
          { userId: "b", peakViewers: 4, publicPeakViewers: 4 },
        ]);
        expect((await records()).mostViewers).toEqual({
          streamer: { id: "a", username: "a", image: null },
          viewers: 9,
        });
      });

      it("is not moved by a private peak, for any caller", async () => {
        await db.insert(userStats).values([
          { userId: "a", peakViewers: 50, publicPeakViewers: 3 },
          { userId: "b", peakViewers: 40, publicPeakViewers: 0 },
        ]);
        for (const caller of [visitor, host, admin]) {
          expect((await records(caller)).mostViewers).toMatchObject({
            streamer: { id: "a" },
            viewers: 3,
          });
        }
      });

      it("counts a public room in progress", async () => {
        await db.insert(userStats).values({ userId: "a", peakViewers: 1, publicPeakViewers: 1 });
        const { id } = await createRoom(db, host, baseInput);
        await db.insert(presenceIntervals).values(
          ["host", "a", "b"].map((userId) => ({
            roomId: id,
            userId,
            startedAt: ago(30),
            lastSeenAt: ago(0),
          })),
        );
        await db
          .insert(streamIntervals)
          .values({ roomId: id, userId: "host", startedAt: ago(30), lastSeenAt: ago(0) });
        // Two others were with the host at once.
        expect((await records()).mostViewers).toMatchObject({
          streamer: { id: "host" },
          viewers: 2,
        });
      });

      it("breaks a tie by the lowest user id", async () => {
        await db.insert(userStats).values([
          { userId: "b", publicPeakViewers: 5 },
          { userId: "a", publicPeakViewers: 5 },
        ]);
        expect((await records()).mostViewers?.streamer.id).toBe("a");
      });
    });

    it("omits only the records with no data", async () => {
      await db.insert(userStats).values({ userId: "a", publicPeakViewers: 2 });
      expect(await records()).toEqual({
        longestRoom: null,
        biggestRoom: null,
        mostViewers: { streamer: { id: "a", username: "a", image: null }, viewers: 2 },
      });
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
