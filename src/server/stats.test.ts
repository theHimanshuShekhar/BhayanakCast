import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import {
  dailyPlatformStats,
  hostIntervals,
  presenceIntervals,
  rooms,
  streamIntervals,
  thumbnails,
  user,
  userCotime,
  userStats,
} from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  dailyStatsNow,
  publicUserCotimeNow,
  publicUserStatsNow,
  purgeExpiredRooms,
  recordNewUser,
  rollupEndedRoom,
  userCotimeNow,
  userStatsNow,
} from "./stats.ts";

const T0 = new Date("2026-09-01T12:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db
    .insert(user)
    .values(["a", "b", "c", "d"].map((id) => ({ id, name: id, email: `${id}@discord.invalid` })));
});

afterEach(async () => {
  await close();
});

type Span = [userId: string, start: number, end: number | null, lastSeen?: number];

async function seedRoom(
  id: string,
  opts: {
    createdBy?: string;
    isPrivate?: boolean;
    createdAt?: Date;
    endedAt?: Date | null;
    presence?: Span[];
    streams?: Span[];
    hosts?: Span[];
  },
) {
  const createdAt = opts.createdAt ?? T0;
  await db.insert(rooms).values({
    id,
    name: id,
    createdBy: opts.createdBy ?? "a",
    hostUserId: opts.createdBy ?? "a",
    isPrivate: opts.isPrivate ?? false,
    createdAt,
    endedAt: opts.endedAt === undefined ? at(60) : opts.endedAt,
  });
  const base = createdAt.getTime();
  const toRows = (spans: Span[]) =>
    spans.map(([userId, start, end, lastSeen]) => ({
      roomId: id,
      userId,
      startedAt: new Date(base + start * MIN),
      endedAt: end === null ? null : new Date(base + end * MIN),
      lastSeenAt: new Date(base + (lastSeen ?? end ?? start) * MIN),
    }));
  if (opts.presence?.length) await db.insert(presenceIntervals).values(toRows(opts.presence));
  if (opts.streams?.length) await db.insert(streamIntervals).values(toRows(opts.streams));
  if (opts.hosts?.length)
    await db
      .insert(hostIntervals)
      .values(toRows(opts.hosts).map(({ lastSeenAt: _, ...row }) => row));
}

async function statsFor(userId: string) {
  const [row] = await db.select().from(userStats).where(eq(userStats.userId, userId));
  return row;
}

async function cotime() {
  const rows = await db.select().from(userCotime);
  return Object.fromEntries(rows.map((r) => [`${r.userA}-${r.userB}`, r.secondsTogether]));
}

describe("rollupEndedRoom", () => {
  it("computes watched, streamed, peak viewers and pairwise co-time", async () => {
    await seedRoom("r1", {
      createdBy: "a",
      endedAt: at(60),
      presence: [
        ["a", 0, 60],
        ["b", 10, 40],
        ["b", 45, 50],
        // Still open when the room ended; last seen after the end, so clamped to 60.
        ["c", 20, null, 70],
      ],
      streams: [["a", 0, 30]],
    });

    expect(await rollupEndedRoom(db, "r1")).toBe(true);

    expect(await statsFor("a")).toEqual({
      userId: "a",
      // present 60m, of which 30m was spent streaming
      secondsWatched: 30 * 60,
      secondsStreamed: 30 * 60,
      roomsHosted: 1,
      roomsJoined: 1,
      // b and c were both present at minute 20 while a streamed.
      peakViewers: 2,
      // A public room, so the public columns match.
      publicSecondsWatched: 30 * 60,
      publicSecondsStreamed: 30 * 60,
      publicRoomsHosted: 1,
      publicRoomsJoined: 1,
      publicPeakViewers: 2,
    });
    expect(await statsFor("b")).toMatchObject({
      secondsWatched: 35 * 60,
      secondsStreamed: 0,
      roomsHosted: 0,
      roomsJoined: 1,
      peakViewers: 0,
    });
    expect(await statsFor("c")).toMatchObject({ secondsWatched: 40 * 60, roomsJoined: 1 });
    expect(await statsFor("d")).toBeUndefined();

    expect(await cotime()).toEqual({
      "a-b": 35 * 60,
      "a-c": 40 * 60,
      // b 10–40 ∩ c 20–60 = 20m, plus b 45–50 = 5m.
      "b-c": 25 * 60,
    });

    const daily = await db.select().from(dailyPlatformStats);
    expect(daily).toEqual([{ day: "2026-09-01", newUsers: 0, roomsCreated: 1, roomsEnded: 1 }]);
  });

  it("closes open intervals at their last-seen checkpoint", async () => {
    await seedRoom("r1", {
      endedAt: at(60),
      presence: [
        ["a", 0, null, 25],
        ["b", 0, null, 10],
      ],
    });
    await rollupEndedRoom(db, "r1");
    expect(await statsFor("a")).toMatchObject({ secondsWatched: 25 * 60 });
    expect(await cotime()).toEqual({ "a-b": 10 * 60 });
  });

  it("merges a user's overlapping spans so nothing is double counted", async () => {
    await seedRoom("r1", {
      presence: [
        ["a", 0, 30],
        ["d", 0, 20],
        ["d", 10, 30],
      ],
      streams: [
        ["d", 0, 15],
        ["d", 5, 20],
      ],
    });
    await rollupEndedRoom(db, "r1");
    expect(await statsFor("d")).toMatchObject({
      // merged presence 0–30 minus merged stream 0–20
      secondsWatched: 10 * 60,
      secondsStreamed: 20 * 60,
      peakViewers: 1,
    });
    expect(await cotime()).toEqual({ "a-d": 30 * 60 });
  });

  it("is idempotent and accumulates across rooms", async () => {
    await seedRoom("r1", {
      presence: [
        ["a", 0, 10],
        ["b", 0, 10],
      ],
    });
    await seedRoom("r2", {
      createdBy: "b",
      presence: [
        ["a", 0, 5],
        ["b", 0, 5],
      ],
    });

    expect(await rollupEndedRoom(db, "r1")).toBe(true);
    expect(await rollupEndedRoom(db, "r1")).toBe(false);
    expect(await rollupEndedRoom(db, "r2")).toBe(true);
    expect(await rollupEndedRoom(db, "r2")).toBe(false);

    expect(await statsFor("a")).toMatchObject({
      secondsWatched: 15 * 60,
      roomsJoined: 2,
      roomsHosted: 1,
    });
    expect(await statsFor("b")).toMatchObject({ roomsJoined: 2, roomsHosted: 1 });
    expect(await cotime()).toEqual({ "a-b": 15 * 60 });
    const [daily] = await db.select().from(dailyPlatformStats);
    expect(daily).toMatchObject({ roomsCreated: 2, roomsEnded: 2 });
  });

  it("credits everyone who held host once, not just the creator", async () => {
    await seedRoom("r1", {
      createdBy: "a",
      presence: [
        ["a", 0, 20],
        ["b", 0, 60],
        ["c", 0, 60],
      ],
      hosts: [
        ["a", 0, 20],
        ["b", 20, 40],
        ["c", 40, 50],
        // b held host twice in the same room; still counts once.
        ["b", 50, 60],
      ],
    });
    await rollupEndedRoom(db, "r1");
    expect(await statsFor("a")).toMatchObject({ roomsHosted: 1 });
    expect(await statsFor("b")).toMatchObject({ roomsHosted: 1 });
    expect(await statsFor("c")).toMatchObject({ roomsHosted: 1 });
  });

  it("folds a private room into the all-rooms columns only, and a public one into both", async () => {
    const spans: Span[] = [
      ["a", 0, 60],
      ["b", 0, 30],
    ];
    await seedRoom("priv", { isPrivate: true, presence: spans, streams: [["a", 0, 20]] });
    await rollupEndedRoom(db, "priv");
    expect(await statsFor("a")).toEqual({
      userId: "a",
      secondsStreamed: 20 * 60,
      secondsWatched: 40 * 60,
      roomsHosted: 1,
      roomsJoined: 1,
      peakViewers: 1,
      publicSecondsStreamed: 0,
      publicSecondsWatched: 0,
      publicRoomsHosted: 0,
      publicRoomsJoined: 0,
      publicPeakViewers: 0,
    });
    expect(await db.select().from(userCotime)).toEqual([
      { userA: "a", userB: "b", secondsTogether: 30 * 60, publicSecondsTogether: 0 },
    ]);

    await seedRoom("pub", { presence: spans, streams: [["a", 0, 10]] });
    await rollupEndedRoom(db, "pub");
    expect(await statsFor("a")).toMatchObject({
      secondsStreamed: 30 * 60,
      roomsJoined: 2,
      publicSecondsStreamed: 10 * 60,
      publicSecondsWatched: 50 * 60,
      publicRoomsHosted: 1,
      publicRoomsJoined: 1,
      publicPeakViewers: 1,
    });
    expect(await db.select().from(userCotime)).toEqual([
      { userA: "a", userB: "b", secondsTogether: 60 * 60, publicSecondsTogether: 30 * 60 },
    ]);
  });

  it("leaves rooms that haven't ended alone", async () => {
    await seedRoom("live", { endedAt: null, presence: [["a", 0, null, 5]] });
    expect(await rollupEndedRoom(db, "live")).toBe(false);
    expect(await statsFor("a")).toBeUndefined();
    const [room] = await db.select().from(rooms).where(eq(rooms.id, "live"));
    expect(room?.statsRolledUpAt).toBeNull();
  });
});

/**
 * Everything the readers see: per-user stats, pairwise co-time and rooms created per day.
 * (Rooms ended is left out: it only moves at the roll-up.)
 */
async function statsNow() {
  const stats = await db
    .select({
      userId: userStatsNow.userId,
      secondsStreamed: userStatsNow.secondsStreamed,
      secondsWatched: userStatsNow.secondsWatched,
      roomsHosted: userStatsNow.roomsHosted,
      roomsJoined: userStatsNow.roomsJoined,
      peakViewers: userStatsNow.peakViewers,
    })
    .from(userStatsNow.from)
    .orderBy(userStatsNow.userId);
  const pairs = await db
    .select({
      userA: userCotimeNow.userA,
      userB: userCotimeNow.userB,
      secondsTogether: userCotimeNow.secondsTogether,
    })
    .from(userCotimeNow.from)
    .orderBy(userCotimeNow.userA, userCotimeNow.userB);
  const days = await db
    .select({
      day: dailyStatsNow.day,
      roomsCreated: dailyStatsNow.roomsCreated,
    })
    .from(dailyStatsNow.from)
    .orderBy(dailyStatsNow.day);
  return { stats, pairs, days };
}

describe("stats including rooms in progress", () => {
  const seedLive = () =>
    seedRoom("live", {
      createdBy: "a",
      endedAt: null,
      presence: [
        // Open intervals count up to their last-seen checkpoint.
        ["a", 0, null, 50],
        ["b", 10, null, 40],
        ["c", 20, 30],
      ],
      streams: [["a", 0, null, 30]],
    });

  it("counts a live room's open intervals in every total", async () => {
    await seedLive();

    expect(await statsNow()).toEqual({
      stats: [
        {
          userId: "a",
          // present 0–50, of which 0–30 streaming
          secondsWatched: 20 * 60,
          secondsStreamed: 30 * 60,
          roomsHosted: 1,
          roomsJoined: 1,
          // b (10–40) and c (20–30) were both there at minute 20.
          peakViewers: 2,
        },
        {
          userId: "b",
          secondsWatched: 30 * 60,
          secondsStreamed: 0,
          roomsHosted: 0,
          roomsJoined: 1,
          peakViewers: 0,
        },
        {
          userId: "c",
          secondsWatched: 10 * 60,
          secondsStreamed: 0,
          roomsHosted: 0,
          roomsJoined: 1,
          peakViewers: 0,
        },
      ],
      pairs: [
        { userA: "a", userB: "b", secondsTogether: 30 * 60 },
        { userA: "a", userB: "c", secondsTogether: 10 * 60 },
        { userA: "b", userB: "c", secondsTogether: 10 * 60 },
      ],
      days: [{ day: "2026-09-01", roomsCreated: 1 }],
    });
    // The read writes nothing.
    expect(await statsFor("a")).toBeUndefined();
    expect(await cotime()).toEqual({});
    expect(await db.select().from(dailyPlatformStats)).toEqual([]);
  });

  it.each([
    ["open intervals left as the crash left them", false],
    ["intervals closed at their checkpoint", true],
  ])("shows the same totals just before and just after the roll-up: %s", async (_, closed) => {
    await seedLive();
    // A room rolled up earlier, so the stored totals aren't empty.
    await seedRoom("earlier", {
      createdBy: "b",
      createdAt: new Date(T0.getTime() - DAY),
      endedAt: new Date(T0.getTime() - DAY + 30 * MIN),
      presence: [
        ["a", 0, 30],
        ["b", 0, 30],
      ],
      streams: [["b", 0, 30]],
    });
    await rollupEndedRoom(db, "earlier");

    const before = await statsNow();
    expect(before.stats.find((row) => row.userId === "b")).toMatchObject({
      secondsWatched: (30 + 0) * 60,
      secondsStreamed: 30 * 60,
      roomsJoined: 2,
      roomsHosted: 1,
    });

    // The room ends at minute 60, after every checkpoint.
    await db
      .update(rooms)
      .set({ endedAt: at(60) })
      .where(eq(rooms.id, "live"));
    if (closed) {
      for (const table of [presenceIntervals, streamIntervals]) {
        await db
          .update(table)
          .set({ endedAt: table.lastSeenAt })
          .where(and(eq(table.roomId, "live"), isNull(table.endedAt)));
      }
    }
    // Ended but not rolled up: still counted once.
    expect((await statsNow()).stats).toEqual(before.stats);
    expect((await statsNow()).pairs).toEqual(before.pairs);

    expect(await rollupEndedRoom(db, "live")).toBe(true);
    const after = await statsNow();
    expect(after.stats).toEqual(before.stats);
    expect(after.pairs).toEqual(before.pairs);
    // Rooms created were counted while live; only rooms ended moves at the roll-up.
    expect(after.days).toEqual(before.days);
    expect(after.days).toEqual([
      { day: "2026-08-31", roomsCreated: 1 },
      { day: "2026-09-01", roomsCreated: 1 },
    ]);
    expect(
      (await db.select().from(dailyPlatformStats).orderBy(dailyPlatformStats.day)).map(
        (row) => row.roomsEnded,
      ),
    ).toEqual([1, 1]);
    // ...and what's stored now is the whole of it.
    expect(await statsFor("a")).toMatchObject({ secondsStreamed: 30 * 60, roomsJoined: 2 });
  });

  it("counts an ended room awaiting roll-up once, before and after the purge job", async () => {
    await seedRoom("ended", {
      presence: [
        ["a", 0, 60],
        ["b", 0, 30],
      ],
      streams: [["a", 0, 60]],
    });
    const before = await statsNow();
    expect(before.stats.find((row) => row.userId === "a")).toMatchObject({
      secondsStreamed: 60 * 60,
      roomsJoined: 1,
      peakViewers: 1,
    });

    expect(await purgeExpiredRooms(db, at(61))).toEqual({ rolledUp: 1, purged: 0 });
    expect(await statsNow()).toEqual(before);
    expect(await purgeExpiredRooms(db, at(62))).toEqual({ rolledUp: 0, purged: 0 });
    expect(await statsNow()).toEqual(before);
  });

  it("adds live totals to stored ones, taking the larger peak rather than the sum", async () => {
    // a streamed to two viewers in a room that has rolled up.
    await seedRoom("rolled", {
      createdBy: "a",
      presence: [
        ["a", 0, 30],
        ["b", 0, 30],
        ["c", 0, 30],
      ],
      streams: [["a", 0, 30]],
    });
    await rollupEndedRoom(db, "rolled");
    // Live: a streams to one viewer, b to two.
    await seedRoom("live", {
      createdBy: "b",
      endedAt: null,
      presence: [
        ["a", 0, null, 20],
        ["b", 0, null, 20],
        ["c", 5, null, 20],
      ],
      streams: [
        ["a", 0, 4],
        ["b", 0, null, 20],
      ],
    });

    const { stats } = await statsNow();
    const byUser = (id: string) => stats.find((row) => row.userId === id);
    expect(byUser("a")).toEqual({
      userId: "a",
      // 30 stored + 4 live streamed; 0 + 16 live watched
      secondsStreamed: 34 * 60,
      secondsWatched: 16 * 60,
      roomsHosted: 1,
      roomsJoined: 2,
      // Stored 2, live 1 (only b at minute 0; c joins after a stops): the larger, not 3.
      peakViewers: 2,
    });
    expect(byUser("b")).toMatchObject({
      secondsStreamed: 20 * 60,
      secondsWatched: 30 * 60,
      roomsHosted: 1,
      peakViewers: 2,
    });
  });

  it("floors seconds per room, as the roll-up does, so totals don't move at roll-up", async () => {
    // 1.5 s together in each of two rooms: 1 s each once floored, not 3 s from the sum.
    for (const id of ["r1", "r2"]) {
      await seedRoom(id, {
        presence: [
          ["a", 0, 0.025],
          ["b", 0, 0.025],
        ],
      });
    }
    const before = await statsNow();
    expect(before.pairs).toEqual([{ userA: "a", userB: "b", secondsTogether: 2 }]);
    expect(before.stats.find((row) => row.userId === "a")?.secondsWatched).toBe(2);

    await rollupEndedRoom(db, "r1");
    await rollupEndedRoom(db, "r2");
    expect(await cotime()).toEqual({ "a-b": 2 });
    expect(await statsNow()).toEqual(before);
  });
});

/**
 * The public-only views, as `statsNow` reads the all-rooms ones. A user or pair with nothing
 * but zeros is left out: it reads the same as no row, and a private room's roll-up leaves one.
 */
async function publicStatsNow() {
  const stats = await db
    .select({
      userId: publicUserStatsNow.userId,
      secondsStreamed: publicUserStatsNow.secondsStreamed,
      secondsWatched: publicUserStatsNow.secondsWatched,
      roomsHosted: publicUserStatsNow.roomsHosted,
      roomsJoined: publicUserStatsNow.roomsJoined,
      peakViewers: publicUserStatsNow.peakViewers,
    })
    .from(publicUserStatsNow.from)
    .orderBy(publicUserStatsNow.userId);
  const nonZero = (row: object) =>
    Object.values(row).some((value) => typeof value === "number" && value > 0);
  const pairs = await db
    .select({
      userA: publicUserCotimeNow.userA,
      userB: publicUserCotimeNow.userB,
      secondsTogether: publicUserCotimeNow.secondsTogether,
    })
    .from(publicUserCotimeNow.from)
    .orderBy(publicUserCotimeNow.userA, publicUserCotimeNow.userB);
  return { stats: stats.filter(nonZero), pairs: pairs.filter(nonZero) };
}

describe("public-only stats (private rooms left out)", () => {
  // Live private room (a, b, c) and a live public one (a, b), plus a rolled-up room of each kind.
  const seedAll = async () => {
    await seedRoom("live-private", {
      createdBy: "c",
      isPrivate: true,
      endedAt: null,
      presence: [
        ["a", 0, null, 40],
        ["b", 0, null, 40],
        ["c", 0, null, 40],
      ],
      streams: [["c", 0, null, 40]],
    });
    await seedRoom("live-public", {
      createdBy: "a",
      endedAt: null,
      presence: [
        ["a", 0, null, 30],
        ["b", 10, null, 30],
      ],
      streams: [["a", 0, null, 30]],
    });
    const earlier = (id: string, isPrivate: boolean) =>
      seedRoom(id, {
        createdBy: "a",
        isPrivate,
        createdAt: new Date(T0.getTime() - DAY),
        endedAt: new Date(T0.getTime() - DAY + 30 * MIN),
        presence: [
          ["a", 0, 30],
          ["d", 0, 30],
        ],
        streams: [["a", 0, 30]],
      });
    await earlier("earlier-private", true);
    await earlier("earlier-public", false);
    await rollupEndedRoom(db, "earlier-private");
    await rollupEndedRoom(db, "earlier-public");
  };

  it("counts public rooms only, live or rolled up", async () => {
    await seedAll();
    expect(await publicStatsNow()).toEqual({
      stats: [
        {
          userId: "a",
          // live public: present 0-30 and streaming all of it; earlier public: the same again
          secondsStreamed: 60 * 60,
          secondsWatched: 0,
          roomsHosted: 2,
          roomsJoined: 2,
          peakViewers: 1,
        },
        {
          userId: "b",
          secondsStreamed: 0,
          secondsWatched: 20 * 60,
          roomsHosted: 0,
          roomsJoined: 1,
          peakViewers: 0,
        },
        {
          userId: "d",
          secondsStreamed: 0,
          secondsWatched: 30 * 60,
          roomsHosted: 0,
          roomsJoined: 1,
          peakViewers: 0,
        },
      ],
      // c was only ever in the private rooms, so has no pairs; a-b's private 40 minutes and
      // a-d's private 30 are out.
      pairs: [
        { userA: "a", userB: "b", secondsTogether: 20 * 60 },
        { userA: "a", userB: "d", secondsTogether: 30 * 60 },
      ],
    });

    // The all-rooms view still has everything.
    const all = await statsNow();
    expect(all.pairs).toEqual([
      { userA: "a", userB: "b", secondsTogether: (40 + 20) * 60 },
      { userA: "a", userB: "c", secondsTogether: 40 * 60 },
      { userA: "a", userB: "d", secondsTogether: 60 * 60 },
      { userA: "b", userB: "c", secondsTogether: 40 * 60 },
    ]);
    expect(all.stats.find((row) => row.userId === "c")).toMatchObject({
      secondsStreamed: 40 * 60,
      roomsJoined: 1,
    });
  });

  it.each([
    ["open intervals left as the crash left them", false],
    ["intervals closed at their checkpoint", true],
  ])("shows the same totals just before and just after the roll-up: %s", async (_, closed) => {
    await seedAll();
    const before = { all: await statsNow(), public: await publicStatsNow() };

    for (const id of ["live-private", "live-public"]) {
      await db
        .update(rooms)
        .set({ endedAt: at(60) })
        .where(eq(rooms.id, id));
      if (closed) {
        for (const table of [presenceIntervals, streamIntervals]) {
          await db
            .update(table)
            .set({ endedAt: table.lastSeenAt })
            .where(and(eq(table.roomId, id), isNull(table.endedAt)));
        }
      }
    }
    // Ended but not rolled up: still counted once.
    expect(await publicStatsNow()).toEqual(before.public);

    expect(await rollupEndedRoom(db, "live-private")).toBe(true);
    expect(await publicStatsNow()).toEqual(before.public);
    expect(await statsNow()).toEqual(before.all);
    expect(await rollupEndedRoom(db, "live-public")).toBe(true);
    expect(await publicStatsNow()).toEqual(before.public);
    expect(await statsNow()).toEqual(before.all);
  });
});

describe("public-only backfill (migration 0005)", () => {
  /** The migration's UPDATE statements: the part after its column additions. */
  const backfill = () => {
    const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
    const file = readdirSync(folder).find((name) => name.startsWith("0005_"));
    const statements = readFileSync(`${folder}/${file}`, "utf8").split("--> statement-breakpoint");
    return statements.filter((statement) => !/^\s*ALTER TABLE/.test(statement));
  };

  it("recomputes the public columns from the rooms that still exist, as the roll-up wrote them", async () => {
    const spans: Span[] = [
      ["a", 0, 60],
      ["b", 0, 30],
      ["c", 20, 60],
    ];
    await seedRoom("pub", { presence: spans, streams: [["a", 0, 30]] });
    await seedRoom("priv", {
      isPrivate: true,
      createdBy: "c",
      presence: spans,
      streams: [["c", 20, 60]],
    });
    await rollupEndedRoom(db, "pub");
    await rollupEndedRoom(db, "priv");
    const written = await db.select().from(userStats).orderBy(userStats.userId);
    const writtenCotime = await db
      .select()
      .from(userCotime)
      .orderBy(userCotime.userA, userCotime.userB);
    expect(written.find((row) => row.userId === "c")).toMatchObject({
      publicRoomsHosted: 0,
      publicPeakViewers: 0,
    });

    // The state migration 0005 meets: stored totals with no public columns, plus time from
    // rooms the purge deleted since, which can't be told public from private.
    await db.update(userStats).set({
      publicSecondsStreamed: 0,
      publicSecondsWatched: 0,
      publicRoomsHosted: 0,
      publicRoomsJoined: 0,
      publicPeakViewers: 0,
    });
    await db.update(userCotime).set({ publicSecondsTogether: 0 });
    await db.execute(sql`update user_stats set seconds_watched = seconds_watched + 999`);
    await db.execute(sql`update user_cotime set seconds_together = seconds_together + 999`);
    // A room in progress, which the roll-up (and so the backfill) doesn't cover yet.
    await seedRoom("live", { endedAt: null, presence: [["a", 0, null, 10]] });

    for (const statement of backfill()) await db.execute(sql.raw(statement));

    expect(await db.select().from(userStats).orderBy(userStats.userId)).toEqual(
      written.map((row) => ({ ...row, secondsWatched: row.secondsWatched + 999 })),
    );
    expect(await db.select().from(userCotime).orderBy(userCotime.userA, userCotime.userB)).toEqual(
      writtenCotime.map((row) => ({ ...row, secondsTogether: row.secondsTogether + 999 })),
    );
    // So the public view reads only the public room (and the live one), not the private one.
    expect((await publicStatsNow()).stats.find((row) => row.userId === "c")).toMatchObject({
      secondsWatched: 40 * 60,
      roomsHosted: 0,
    });
  });
});

describe("purgeExpiredRooms", () => {
  it("rolls up missed rooms, deletes expired ones, and keeps stats", async () => {
    const now = new Date(T0.getTime() + 40 * DAY);
    await seedRoom("old", {
      createdAt: T0,
      endedAt: at(60),
      presence: [
        ["a", 0, 60],
        ["b", 0, 30],
      ],
      streams: [["a", 0, 60]],
    });
    await db.insert(thumbnails).values({
      roomId: "old",
      userId: "a",
      capturedAt: at(3),
      image: new Uint8Array([1, 2, 3]),
    });
    const recentStart = new Date(now.getTime() - 5 * DAY);
    await seedRoom("recent", {
      createdAt: recentStart,
      endedAt: new Date(recentStart.getTime() + 10 * MIN),
      presence: [["c", 0, 10]],
    });
    await seedRoom("live", { createdAt: now, endedAt: null, presence: [["d", 0, null]] });

    expect(await purgeExpiredRooms(db, now)).toEqual({ rolledUp: 2, purged: 1 });

    const remaining = (await db.select({ id: rooms.id }).from(rooms)).map((r) => r.id).sort();
    expect(remaining).toEqual(["live", "recent"]);
    // Room-scoped rows cascaded away with the room.
    expect(
      await db.select().from(presenceIntervals).where(eq(presenceIntervals.roomId, "old")),
    ).toEqual([]);
    expect(
      await db.select().from(streamIntervals).where(eq(streamIntervals.roomId, "old")),
    ).toEqual([]);
    expect(await db.select().from(thumbnails)).toEqual([]);
    // Stats survive the purge.
    expect(await statsFor("a")).toMatchObject({
      // streamed the whole time, so no watch time
      secondsWatched: 0,
      secondsStreamed: 60 * 60,
      // "old" and "recent" were rolled up; "live" hasn't ended.
      roomsHosted: 2,
      peakViewers: 1,
    });
    expect(await statsFor("c")).toMatchObject({ secondsWatched: 10 * 60 });
    expect(await cotime()).toEqual({ "a-b": 30 * 60 });

    // Running again is a no-op.
    expect(await purgeExpiredRooms(db, now)).toEqual({ rolledUp: 0, purged: 0 });
    expect(await statsFor("a")).toMatchObject({ secondsStreamed: 60 * 60 });
  });

  it("keeps rooms ended less than 30 days ago", async () => {
    await seedRoom("r1", { endedAt: at(60), presence: [["a", 0, 60]] });
    const now = new Date(at(60).getTime() + 29 * DAY);
    expect(await purgeExpiredRooms(db, now)).toEqual({ rolledUp: 1, purged: 0 });
  });
});

describe("recordNewUser", () => {
  it("counts sign-ups per UTC day", async () => {
    await recordNewUser(db, new Date("2026-09-02T23:59:00Z"));
    await recordNewUser(db, new Date("2026-09-02T00:01:00Z"));
    await recordNewUser(db, new Date("2026-09-03T00:00:00Z"));
    const rows = await db.select().from(dailyPlatformStats).orderBy(dailyPlatformStats.day);
    expect(rows.map((r) => [r.day, r.newUsers])).toEqual([
      ["2026-09-02", 2],
      ["2026-09-03", 1],
    ]);
  });
});
