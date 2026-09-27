import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import {
  dailyPlatformStats,
  presenceIntervals,
  rooms,
  user,
  userStats,
} from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { percentChange } from "../lib/admin.ts";
import {
  getAdminDailySeries,
  getAdminLeaderboards,
  getAdminOverview,
  listAdminLiveRooms,
  listAdminRecentRooms,
} from "./admin.ts";
import { AdminRequiredError, type Caller } from "./caller.ts";

let db: Db;
let close: () => Promise<void>;

const visitor: Caller = { user: null, role: "visitor" };
const plainUser: Caller = { user: { id: "a", username: "a" }, role: "user" };
const admin: Caller = { user: { id: "admin", username: "admin" }, role: "admin" };

const HOUR = 3600;
const now = new Date("2026-09-27T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const daysAgo = (days: number) => minutesAgo(days * 24 * 60);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values(
    ["admin", "a", "b", "c"].map((id) => ({
      id,
      name: id,
      email: `${id}@discord.invalid`,
      discordUsername: `${id}_user`,
      role: id === "admin" ? "admin" : "user",
    })),
  );
});

afterEach(async () => {
  await close();
});

const room = (values: Partial<typeof rooms.$inferInsert> & { id: string }) => ({
  name: values.id,
  hostUserId: "a",
  createdBy: "a",
  createdAt: minutesAgo(60),
  ...values,
});

describe("admin functions refuse non-admins", () => {
  const calls: [string, (caller: Caller) => Promise<unknown>][] = [
    ["getAdminOverview", (caller) => getAdminOverview(db, caller, now)],
    ["getAdminDailySeries", (caller) => getAdminDailySeries(db, caller, now)],
    ["listAdminLiveRooms", (caller) => listAdminLiveRooms(db, caller)],
    ["listAdminRecentRooms", (caller) => listAdminRecentRooms(db, caller, now)],
    ["getAdminLeaderboards", (caller) => getAdminLeaderboards(db, caller)],
  ];
  for (const [name, call] of calls) {
    it(`${name} rejects visitors and users, and answers admins`, async () => {
      await expect(call(visitor)).rejects.toBeInstanceOf(AdminRequiredError);
      await expect(call(plainUser)).rejects.toBeInstanceOf(AdminRequiredError);
      // A forged admin role without a user is still refused.
      await expect(call({ user: null, role: "admin" })).rejects.toBeInstanceOf(AdminRequiredError);
      await expect(call(admin)).resolves.toBeDefined();
    });
  }
});

describe("getAdminOverview", () => {
  it("sums all-time stats, counts live rooms and compares the last 30 days with the 30 before", async () => {
    await db.insert(userStats).values([
      { userId: "a", secondsStreamed: 2 * HOUR, secondsWatched: 10 * HOUR, roomsHosted: 3 },
      { userId: "b", secondsStreamed: 1 * HOUR, secondsWatched: 0.5 * HOUR, roomsHosted: 1 },
    ]);
    await db
      .insert(rooms)
      .values([
        room({ id: "live-public" }),
        room({ id: "live-private", isPrivate: true }),
        room({ id: "ended", endedAt: minutesAgo(5) }),
      ]);
    await db.insert(dailyPlatformStats).values([
      // Today and day 29 are in the window; days 30 and 59 in the one before; day 60 in neither.
      { day: "2026-09-27", newUsers: 2, roomsCreated: 1, roomsEnded: 1 },
      { day: "2026-08-29", newUsers: 1, roomsCreated: 4, roomsEnded: 0 },
      { day: "2026-08-28", newUsers: 5, roomsCreated: 0, roomsEnded: 2 },
      { day: "2026-07-30", newUsers: 1, roomsCreated: 0, roomsEnded: 0 },
      { day: "2026-07-29", newUsers: 100, roomsCreated: 100, roomsEnded: 100 },
    ]);

    expect(await getAdminOverview(db, admin, now)).toEqual({
      totals: { users: 4, hoursStreamed: 3, hoursWatched: 10.5, roomsHosted: 4, liveRooms: 2 },
      window: {
        newUsers: { current: 3, previous: 6 },
        roomsCreated: { current: 5, previous: 0 },
        roomsEnded: { current: 1, previous: 2 },
      },
    });
  });

  it("is all zeros on an empty platform, except the users", async () => {
    const zero = { current: 0, previous: 0 };
    expect(await getAdminOverview(db, admin, now)).toEqual({
      totals: { users: 4, hoursStreamed: 0, hoursWatched: 0, roomsHosted: 0, liveRooms: 0 },
      window: { newUsers: zero, roomsCreated: zero, roomsEnded: zero },
    });
  });
});

describe("getAdminDailySeries", () => {
  it("covers the last 30 UTC days, oldest first, filling gaps with zeros", async () => {
    await db.insert(dailyPlatformStats).values([
      { day: "2026-08-28", newUsers: 9, roomsCreated: 9, roomsEnded: 9 }, // day 30: outside
      { day: "2026-08-29", newUsers: 1, roomsCreated: 2, roomsEnded: 0 },
      { day: "2026-09-10", newUsers: 0, roomsCreated: 3, roomsEnded: 3 },
      { day: "2026-09-27", newUsers: 2, roomsCreated: 0, roomsEnded: 1 },
      { day: "2026-09-28", newUsers: 7, roomsCreated: 7, roomsEnded: 7 }, // tomorrow: outside
    ]);

    const series = await getAdminDailySeries(db, admin, now);

    expect(series).toHaveLength(30);
    expect(series.map((p) => p.day)).toEqual(
      Array.from({ length: 30 }, (_, i) =>
        daysAgo(29 - i)
          .toISOString()
          .slice(0, 10),
      ),
    );
    expect(series[0]).toEqual({
      day: "2026-08-29",
      newUsers: 1,
      roomsCreated: 2,
      roomsEnded: 0,
      cumulativeUsers: 2,
    });
    expect(series.find((p) => p.day === "2026-09-10")).toMatchObject({
      roomsCreated: 3,
      roomsEnded: 3,
    });
    expect(series.find((p) => p.day === "2026-09-01")).toEqual({
      day: "2026-09-01",
      newUsers: 0,
      roomsCreated: 0,
      roomsEnded: 0,
      cumulativeUsers: 2,
    });
    // 4 users today, 2 of whom signed up today.
    expect(series.at(-1)).toEqual({
      day: "2026-09-27",
      newUsers: 2,
      roomsCreated: 0,
      roomsEnded: 1,
      cumulativeUsers: 4,
    });
    expect(series.at(-2)?.cumulativeUsers).toBe(2);
  });

  it("is all zeros without counters, with today's user total throughout", async () => {
    const series = await getAdminDailySeries(db, admin, now);
    expect(series).toHaveLength(30);
    for (const point of series) {
      expect(point).toMatchObject({ newUsers: 0, roomsCreated: 0, roomsEnded: 0 });
      expect(point.cumulativeUsers).toBe(4);
    }
  });
});

describe("listAdminLiveRooms", () => {
  it("lists every live room, private ones included", async () => {
    await db
      .insert(rooms)
      .values([
        room({ id: "public", createdAt: minutesAgo(30) }),
        room({ id: "private", isPrivate: true, hostUserId: "b", createdAt: minutesAgo(10) }),
        room({ id: "ended", endedAt: minutesAgo(1) }),
      ]);
    const live = await listAdminLiveRooms(db, admin);
    expect(live.map((r) => [r.id, r.isPrivate, r.host?.username])).toEqual([
      ["private", true, "b_user"],
      ["public", false, "a_user"],
    ]);
  });
});

describe("listAdminRecentRooms", () => {
  it("lists live rooms and rooms ended within 30 days with peak, joined and duration", async () => {
    await db
      .insert(rooms)
      .values([
        room({ id: "live", isPrivate: true, createdAt: minutesAgo(90) }),
        room({ id: "recent", createdAt: minutesAgo(120), endedAt: minutesAgo(60) }),
        room({ id: "older", createdAt: daysAgo(29), endedAt: daysAgo(29) }),
        room({ id: "purgeable", createdAt: daysAgo(32), endedAt: daysAgo(31) }),
      ]);
    const span = (roomId: string, userId: string, from: number, to: number | null) => ({
      roomId,
      userId,
      startedAt: minutesAgo(from),
      endedAt: to === null ? null : minutesAgo(to),
      lastSeenAt: minutesAgo(to ?? 0),
    });
    await db.insert(presenceIntervals).values([
      // recent: a throughout; b and c overlap a but not each other; a rejoin doesn't double count.
      span("recent", "a", 120, 90),
      span("recent", "a", 95, 60),
      span("recent", "b", 110, 100),
      span("recent", "c", 80, 70),
      // live: a and b still in (open); c overlapped both before leaving.
      span("live", "a", 90, null),
      span("live", "b", 50, null),
      span("live", "c", 60, 40),
    ]);

    const rows = await listAdminRecentRooms(db, admin, now);

    expect(rows.map((r) => r.id)).toEqual(["live", "recent", "older"]);
    expect(rows[0]).toEqual({
      id: "live",
      name: "live",
      isPrivate: true,
      host: { id: "a", username: "a_user" },
      status: "live",
      peak: 3,
      joined: 3,
      durationMinutes: 90,
      createdAt: minutesAgo(90).toISOString(),
      endedAt: null,
    });
    expect(rows[1]).toMatchObject({
      status: "ended",
      peak: 2,
      joined: 3,
      durationMinutes: 60,
      endedAt: minutesAgo(60).toISOString(),
    });
    expect(rows[2]).toMatchObject({ status: "ended", peak: 0, joined: 0 });
  });
});

describe("getAdminLeaderboards", () => {
  it("ranks users by hours streamed and watched, most first, skipping zeros", async () => {
    await db.insert(userStats).values([
      { userId: "a", secondsStreamed: 1 * HOUR, secondsWatched: 0 },
      { userId: "b", secondsStreamed: 5 * HOUR, secondsWatched: 2 * HOUR },
      { userId: "c", secondsStreamed: 3 * HOUR, secondsWatched: 7 * HOUR },
      { userId: "admin", secondsStreamed: 0, secondsWatched: 1 * HOUR },
    ]);
    expect(await getAdminLeaderboards(db, admin)).toEqual({
      streamed: [
        { id: "b", username: "b_user", hours: 5 },
        { id: "c", username: "c_user", hours: 3 },
        { id: "a", username: "a_user", hours: 1 },
      ],
      watched: [
        { id: "c", username: "c_user", hours: 7 },
        { id: "b", username: "b_user", hours: 2 },
        { id: "admin", username: "admin_user", hours: 1 },
      ],
    });
  });

  it("keeps the top 6", async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `u${i}`);
    await db
      .insert(user)
      .values(ids.map((id) => ({ id, name: id, email: `${id}@discord.invalid` })));
    await db
      .insert(userStats)
      .values(ids.map((id, i) => ({ userId: id, secondsStreamed: (i + 1) * HOUR })));
    const { streamed } = await getAdminLeaderboards(db, admin);
    expect(streamed.map((e) => e.id)).toEqual(["u7", "u6", "u5", "u4", "u3", "u2"]);
  });
});

describe("percentChange", () => {
  it("rounds the change to whole percent and has none without a previous value", () => {
    expect(percentChange({ current: 3, previous: 2 })).toBe(50);
    expect(percentChange({ current: 1, previous: 3 })).toBe(-67);
    expect(percentChange({ current: 0, previous: 4 })).toBe(-100);
    expect(percentChange({ current: 5, previous: 0 })).toBeNull();
  });
});
