import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import {
  presenceIntervals,
  roomMembers,
  rooms,
  streamIntervals,
  user,
  userStats,
} from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import type { Caller } from "./caller.ts";
import { getRecap } from "./recaps.ts";
import { listPastRooms } from "./rooms.ts";
import { rollupEndedRoom } from "./stats.ts";

const T0 = new Date("2026-09-01T12:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);
const iso = (minutes: number) => at(minutes).toISOString();
/** A day after the rooms below end: well inside the 30-day window. */
const NOW = new Date(T0.getTime() + DAY);

let db: Db;
let close: () => Promise<void>;

const visitor: Caller = { user: null, role: "visitor" };
const asUser = (id: string): Caller => ({ user: { id, username: id }, role: "user" });
const admin: Caller = { user: { id: "admin", username: "admin" }, role: "admin" };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values(
    ["a", "b", "c", "d", "admin"].map((id) => ({
      id,
      name: id,
      email: `${id}@discord.invalid`,
      discordUsername: `${id}.discord`,
    })),
  );
});

afterEach(async () => {
  await close();
});

type Span = [userId: string, start: number, end: number | null, lastSeen?: number];

/** A room hosted by `host` from T0 to `end` minutes (null: still live), with interval spans in minutes. */
async function seedRoom(
  id: string,
  opts: {
    host?: string;
    end?: number | null;
    endedAt?: Date;
    isPrivate?: boolean;
    presence?: Span[];
    streams?: Span[];
  } = {},
) {
  const host = opts.host ?? "a";
  await db.insert(rooms).values({
    id,
    name: id,
    createdBy: host,
    hostUserId: host,
    isPrivate: opts.isPrivate ?? false,
    createdAt: T0,
    endedAt: opts.endedAt ?? (opts.end === null ? null : at(opts.end ?? 60)),
  });
  await db.insert(roomMembers).values({ roomId: id, userId: host, role: "host" });
  const toRows = (spans: Span[]) =>
    spans.map(([userId, start, end, lastSeen]) => ({
      roomId: id,
      userId,
      startedAt: at(start),
      endedAt: end === null ? null : at(end),
      lastSeenAt: at(lastSeen ?? end ?? start),
    }));
  if (opts.presence?.length) await db.insert(presenceIntervals).values(toRows(opts.presence));
  if (opts.streams?.length) await db.insert(streamIntervals).values(toRows(opts.streams));
}

describe("getRecap", () => {
  it("returns the duration, host, spans and minutes from the intervals", async () => {
    await seedRoom("r1", {
      host: "a",
      end: 60,
      presence: [
        ["a", 0, 60],
        ["b", 10, 40],
        ["b", 45, 50],
        // Still open when the room ended, last seen after it: clamped to the end.
        ["c", 20, null, 70],
      ],
      streams: [["a", 0, 30]],
    });

    const recap = await getRecap(db, visitor, "r1", NOW);
    expect(recap).toMatchObject({
      id: "r1",
      name: "r1",
      host: { id: "a", username: "a.discord" },
      createdAt: iso(0),
      endedAt: iso(60),
      durationMinutes: 60,
      // a 60 - 30 streaming, b 35, c 40
      totalWatchMinutes: 105,
    });
    expect(recap?.people).toEqual([
      {
        id: "a",
        username: "a.discord",
        isHost: true,
        presence: [{ start: iso(0), end: iso(60) }],
        presenceMinutes: 60,
        streams: [{ start: iso(0), end: iso(30) }],
        streamMinutes: 30,
        watchMinutes: 30,
        thumbnailAt: null,
      },
      {
        id: "b",
        username: "b.discord",
        isHost: false,
        presence: [
          { start: iso(10), end: iso(40) },
          { start: iso(45), end: iso(50) },
        ],
        presenceMinutes: 35,
        streams: [],
        streamMinutes: 0,
        watchMinutes: 35,
        thumbnailAt: null,
      },
      {
        id: "c",
        username: "c.discord",
        isHost: false,
        presence: [{ start: iso(20), end: iso(60) }],
        presenceMinutes: 40,
        streams: [],
        streamMinutes: 0,
        watchMinutes: 40,
        thumbnailAt: null,
      },
    ]);
  });

  it("merges overlapping spans and closes open ones at last seen", async () => {
    await seedRoom("r1", {
      end: 60,
      presence: [
        ["a", 0, 60],
        ["d", 0, 20],
        ["d", 10, 30],
        // Touching the previous span: one continuous stay.
        ["d", 30, null, 35],
      ],
      streams: [
        ["d", 0, 15],
        ["d", 5, 20],
        // Open, last seen at 25.
        ["b", 22, null, 25],
      ],
    });

    const recap = await getRecap(db, visitor, "r1", NOW);
    const d = recap?.people.find((p) => p.id === "d");
    expect(d).toMatchObject({
      presence: [{ start: iso(0), end: iso(35) }],
      presenceMinutes: 35,
      streams: [{ start: iso(0), end: iso(20) }],
      streamMinutes: 20,
      watchMinutes: 15,
    });
    // Streamed without presence: listed, with no watch time.
    expect(recap?.people.find((p) => p.id === "b")).toMatchObject({
      presence: [],
      presenceMinutes: 0,
      streams: [{ start: iso(22), end: iso(25) }],
      streamMinutes: 3,
      watchMinutes: 0,
    });
    expect(recap?.people.map((p) => p.id)).toEqual(["a", "d", "b"]);
  });

  it("agrees with the stats roll-up", async () => {
    await seedRoom("r1", {
      end: 90,
      presence: [
        ["a", 0, 50],
        ["a", 40, null, 95],
        ["b", 5, 70],
        ["c", 30, 31],
      ],
      streams: [
        ["b", 10, 25],
        ["b", 20, 60],
        ["a", 80, null, 85],
      ],
    });
    const recap = await getRecap(db, visitor, "r1", NOW);
    await rollupEndedRoom(db, "r1");
    const stats = await db.select().from(userStats);
    expect(stats.length).toBe(3);
    for (const row of stats) {
      const person = recap?.people.find((p) => p.id === row.userId);
      expect(person?.watchMinutes).toBe(row.secondsWatched / 60);
      expect(person?.streamMinutes).toBe(row.secondsStreamed / 60);
    }
    expect(recap?.totalWatchMinutes).toBe(
      stats.reduce((sum, row) => sum + row.secondsWatched, 0) / 60,
    );
  });

  it("returns an ended room with nobody in it", async () => {
    await seedRoom("r1", { end: 5 });
    expect(await getRecap(db, visitor, "r1", NOW)).toMatchObject({
      durationMinutes: 5,
      people: [],
      totalWatchMinutes: 0,
    });
  });

  it("is null for unknown, live and expired rooms", async () => {
    await seedRoom("live", { end: null, presence: [["a", 0, null]] });
    await seedRoom("old", { end: 60 });
    expect(await getRecap(db, admin, "no-such-room", NOW)).toBeNull();
    expect(await getRecap(db, admin, "live", NOW)).toBeNull();
    // Kept for 30 days after it ended, then gone.
    const endedAt = at(60).getTime();
    expect(await getRecap(db, admin, "old", new Date(endedAt + 30 * DAY))).not.toBeNull();
    expect(await getRecap(db, admin, "old", new Date(endedAt + 30 * DAY + 1))).toBeNull();
  });

  it("shows a private room's recap only to its host, approved members and admins", async () => {
    await seedRoom("secret", { host: "a", isPrivate: true, presence: [["b", 0, 10]] });
    await db
      .insert(roomMembers)
      .values({ roomId: "secret", userId: "b", role: "member", approved: true });

    expect(await getRecap(db, visitor, "secret", NOW)).toBeNull();
    expect(await getRecap(db, asUser("c"), "secret", NOW)).toBeNull();
    expect(await getRecap(db, asUser("a"), "secret", NOW)).not.toBeNull();
    expect(await getRecap(db, asUser("b"), "secret", NOW)).not.toBeNull();
    expect(await getRecap(db, admin, "secret", NOW)).not.toBeNull();
  });
});

describe("listPastRooms", () => {
  const ids = async (caller: Caller, input = {}, now = NOW) =>
    (await listPastRooms(db, caller, input, now)).map((room) => room.id);

  it("lists rooms ended within 30 days, most recently ended first", async () => {
    await seedRoom("live", { end: null });
    await seedRoom("first", { end: 30 });
    await seedRoom("second", { end: 60 });
    const now = new Date(at(30).getTime() + 30 * DAY);
    expect(await ids(visitor, {}, now)).toEqual(["second", "first"]);
    // One millisecond later "first" is past the 30-day cutoff.
    expect(await ids(visitor, {}, new Date(now.getTime() + 1))).toEqual(["second"]);
  });

  it("returns the card with duration, people and streamers", async () => {
    await seedRoom("r1", {
      host: "a",
      end: 45,
      presence: [
        ["b", 5, 10],
        ["a", 0, 45],
        ["b", 20, 30],
      ],
      streams: [["b", 6, 9]],
    });
    expect(await listPastRooms(db, visitor, {}, NOW)).toEqual([
      expect.objectContaining({
        id: "r1",
        host: { id: "a", username: "a.discord" },
        createdAt: iso(0),
        endedAt: iso(45),
        durationMinutes: 45,
        people: [
          { id: "a", username: "a.discord" },
          { id: "b", username: "b.discord" },
        ],
        streamers: [{ id: "b", username: "b.discord", thumbnailAt: null }],
      }),
    ]);
  });

  it("filters to rooms a user hosted or joined", async () => {
    await seedRoom("hosted", { host: "c" });
    await seedRoom("joined", { host: "a", presence: [["c", 0, 10]] });
    await seedRoom("other", { host: "a", presence: [["b", 0, 10]] });
    expect((await ids(visitor, { userId: "c" })).sort()).toEqual(["hosted", "joined"]);
    expect(await ids(visitor, { userId: "d" })).toEqual([]);
  });

  it("hides private rooms from visitors and non-members, also on a profile", async () => {
    await seedRoom("public", { host: "a" });
    await seedRoom("secret", { host: "a", isPrivate: true, presence: [["b", 0, 10]] });
    await db
      .insert(roomMembers)
      .values({ roomId: "secret", userId: "b", role: "member", approved: true });

    expect(await ids(visitor)).toEqual(["public"]);
    expect(await ids(asUser("c"), { userId: "b" })).toEqual([]);
    expect((await ids(asUser("b"), { userId: "b" })).sort()).toEqual(["secret"]);
    expect((await ids(admin)).sort()).toEqual(["public", "secret"]);
  });
});
