/**
 * The app's queries against a real Postgres through the production driver (postgres-js, via
 * `createDb`), where every other test uses PGlite: the driver's type handling (bigint as string,
 * timestamptz, bytea, jsonb, arrays, transactions) and migrations applied to a database that
 * already holds data. Needs Docker; `pnpm test:migrate`. Each test gets its own database in the
 * one container.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from "../lib/thumbnails.ts";
import type { Caller } from "../server/caller.ts";
import { getProfile, searchUsers } from "../server/profiles.ts";
import { createRoom, listLiveRooms } from "../server/rooms.ts";
import { getUserSettings, saveUserSettings } from "../server/settings.ts";
import { purgeExpiredRooms, rollupEndedRoom } from "../server/stats.ts";
import { jpegHeader } from "../server/test-images.ts";
import { getThumbnail, uploadThumbnail } from "../server/thumbnails.ts";
import { createDb } from "./client.ts";
import { type PostgresContainer, startPostgresContainer } from "./docker-postgres.ts";
import { applyMigrations, readJournal } from "./migrations.ts";
import { presenceIntervals, rooms, streamIntervals, user, userStats } from "./schema/index.ts";

const realMigrations = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** The newest migration before the public-stats columns (0005) and their backfill. */
const BEFORE_PUBLIC_STATS = "0004_furry_rawhide_kid";

const MIN = 60_000;
const T0 = new Date("2026-09-01T12:00:00Z");
const at = (minutes: number, from = T0) => new Date(from.getTime() + minutes * MIN);

const visitor: Caller = { user: null, role: "visitor" };
const adminCaller: Caller = {
  user: { id: "admin", username: "admin", image: null },
  role: "admin",
};
const asUser = (id: string): Caller => ({ user: { id, username: id, image: null }, role: "user" });

let container: PostgresContainer;
let dbUrl: string;
/** The production pool: what `getDb()` is in the server. */
let db: ReturnType<typeof createDb>["db"];
let closeDb: () => Promise<void>;
const folders: string[] = [];

beforeAll(async () => {
  container = await startPostgresContainer("postgres");
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

beforeEach(async () => {
  dbUrl = await container.createDatabase();
  ({ db, close: closeDb } = createDb(dbUrl, { max: 3, onnotice: () => {} }));
});

afterEach(async () => {
  await closeDb();
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

/** A migrations folder holding the real migrations up to and including `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const journal = readJournal(realMigrations);
  const count = journal.findIndex((entry) => entry.tag === lastTag) + 1;
  if (count === 0) throw new Error(`No migration ${lastTag}`);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "bhayanakcast-migrations-"));
  folders.push(folder);
  fs.mkdirSync(path.join(folder, "meta"));
  const kept = journal.slice(0, count);
  for (const { tag } of kept) {
    fs.copyFileSync(path.join(realMigrations, `${tag}.sql`), path.join(folder, `${tag}.sql`));
  }
  const entries = kept.map(({ tag, when }, idx) => ({
    idx,
    version: "7",
    when,
    tag,
    breakpoints: true,
  }));
  fs.writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries }),
  );
  return folder;
}

describe("migrating a populated database to head", () => {
  /**
   * What production looked like before #64: one public and one private room, both ended and
   * rolled up into the all-rooms columns, and nothing in the public ones (they don't exist yet).
   * Raw SQL, since the app's schema describes head.
   */
  beforeEach(async () => {
    const raw = postgres(dbUrl, { max: 2, onnotice: () => {} });
    try {
      await applyMigrations(raw, migrationsUpTo(BEFORE_PUBLIC_STATS));
      for (const id of ["a", "b"]) {
        await raw`insert into "user" (id, name, email) values (${id}, ${id}, ${`${id}@discord.invalid`})`;
      }
      // ISO strings: the driver can't type a bare Date parameter in a raw query.
      const iso = (minutes: number, from: Date) => at(minutes, from).toISOString();
      const room = async (id: string, isPrivate: boolean, start: Date) => {
        await raw`insert into rooms (id, name, is_private, created_by, host_user_id, created_at,
            ended_at, stats_rolled_up_at)
          values (${id}, ${id}, ${isPrivate}, 'a', 'a', ${start.toISOString()}, ${iso(60, start)}, ${iso(61, start)})`;
      };
      const present = async (roomId: string, userId: string, from: Date, a: number, b: number) => {
        await raw`insert into presence_intervals (room_id, user_id, started_at, ended_at, last_seen_at)
          values (${roomId}, ${userId}, ${iso(a, from)}, ${iso(b, from)}, ${iso(b, from)})`;
      };
      const streams = async (roomId: string, userId: string, from: Date, a: number, b: number) => {
        await raw`insert into stream_intervals (room_id, user_id, started_at, ended_at, last_seen_at)
          values (${roomId}, ${userId}, ${iso(a, from)}, ${iso(b, from)}, ${iso(b, from)})`;
      };

      // Public: a is there for 60 minutes and shares for the first 30; b is there from 10 to 40.
      await room("pub", false, T0);
      await present("pub", "a", T0, 0, 60);
      await present("pub", "b", T0, 10, 40);
      await streams("pub", "a", T0, 0, 30);
      // Private, two hours later: both there for the whole hour, a sharing all of it.
      const later = at(120);
      await room("priv", true, later);
      await present("priv", "a", later, 0, 60);
      await present("priv", "b", later, 0, 60);
      await streams("priv", "a", later, 0, 60);

      // What the roll-up stored for those two rooms (all-rooms columns, as it did then).
      await raw`insert into user_stats (user_id, seconds_streamed, seconds_watched, rooms_hosted,
          rooms_joined, peak_viewers)
        values ('a', 5400, 1800, 2, 2, 1), ('b', 0, 5400, 0, 2, 0)`;
      await raw`insert into user_cotime (user_a, user_b, seconds_together) values ('a', 'b', 5400)`;
      // Deploy: the rest of the migrations, over that data.
      await applyMigrations(raw, realMigrations);
    } finally {
      await raw.end();
    }
  });

  it("applies the rest, backfills the public columns from public rooms only and keeps the rest", async () => {
    const raw = postgres(dbUrl, { max: 1 });
    try {
      const applied = await raw`select count(*)::int as n from drizzle.__drizzle_migrations`;
      expect(applied[0]?.n).toBe(readJournal(realMigrations).length);

      const stats = await raw`select user_id, seconds_streamed::int, seconds_watched::int,
          rooms_hosted, rooms_joined, peak_viewers,
          public_seconds_streamed::int as pub_streamed, public_seconds_watched::int as pub_watched,
          public_rooms_hosted as pub_hosted, public_rooms_joined as pub_joined,
          public_peak_viewers as pub_peak
        from user_stats order by user_id`;
      expect(stats.map((row) => ({ ...row }))).toEqual([
        {
          user_id: "a",
          // Untouched: both rooms.
          seconds_streamed: 5400,
          seconds_watched: 1800,
          rooms_hosted: 2,
          rooms_joined: 2,
          peak_viewers: 1,
          // Recomputed: the public room only (60 min there, 30 of them sharing; b joined at 10).
          pub_streamed: 1800,
          pub_watched: 1800,
          pub_hosted: 1,
          pub_joined: 1,
          pub_peak: 1,
        },
        {
          user_id: "b",
          seconds_streamed: 0,
          seconds_watched: 5400,
          rooms_hosted: 0,
          rooms_joined: 2,
          peak_viewers: 0,
          pub_streamed: 0,
          pub_watched: 1800,
          pub_hosted: 0,
          pub_joined: 1,
          pub_peak: 0,
        },
      ]);

      const [pair] =
        await raw`select seconds_together::int as together, public_seconds_together::int as pub
          from user_cotime where user_a = 'a' and user_b = 'b'`;
      // Together 30 minutes in the public room, a full hour more in the private one.
      expect(pair).toMatchObject({ together: 5400, pub: 1800 });

      const [index] = await raw`select to_regclass('rooms_unrolled_idx') is not null as found`;
      expect(index?.found).toBe(true);
    } finally {
      await raw.end();
    }
  });

  it("serves profiles through the driver: the private room's hours for admins only", async () => {
    const forVisitor = await getProfile(db, visitor, "a");
    expect(forVisitor?.stats).toEqual({
      hoursStreamed: 0.5,
      hoursWatched: 0.5,
      roomsHosted: 1,
      roomsJoined: 1,
      peakViewers: 1,
    });
    expect(forVisitor?.coUsers).toMatchObject([{ id: "b", secondsTogether: 1800 }]);

    const forAdmin = await getProfile(db, adminCaller, "a");
    expect(forAdmin?.stats).toEqual({
      hoursStreamed: 1.5,
      hoursWatched: 0.5,
      roomsHosted: 2,
      roomsJoined: 2,
      peakViewers: 1,
    });
    expect(forAdmin?.coUsers).toMatchObject([{ id: "b", secondsTogether: 5400 }]);
  });
});

describe("the app's queries on a migrated database", () => {
  beforeEach(async () => {
    const raw = postgres(dbUrl, { max: 2, onnotice: () => {} });
    try {
      await applyMigrations(raw, realMigrations);
    } finally {
      await raw.end();
    }
    await db.insert(user).values([
      { id: "a", name: "Ana", email: "a@discord.invalid", discordUsername: "ana" },
      { id: "b", name: "Bo", email: "b@discord.invalid", discordUsername: "bo" },
    ]);
  });

  /** An ended public room, a streaming 0-30 and present 0-60, b present 10-40. */
  async function endedRoom(id: string, start: Date) {
    await db.insert(rooms).values({
      id,
      name: id,
      createdBy: "a",
      hostUserId: "a",
      createdAt: start,
      endedAt: at(60, start),
    });
    const spans = (userId: string, a: number, b: number) => ({
      roomId: id,
      userId,
      startedAt: at(a, start),
      endedAt: at(b, start),
      lastSeenAt: at(b, start),
    });
    await db.insert(presenceIntervals).values([spans("a", 0, 60), spans("b", 10, 40)]);
    await db.insert(streamIntervals).values(spans("a", 0, 30));
  }

  it("rolls up an ended room once (a transaction, bigint columns) and shows it on profiles and search", async () => {
    await endedRoom("r1", T0);
    expect(await rollupEndedRoom(db, "r1")).toBe(true);
    expect(await rollupEndedRoom(db, "r1")).toBe(false);

    const [stored] = await db.select().from(userStats).where(eq(userStats.userId, "a"));
    // bigint columns come back as numbers (`mode: "number"`), not the driver's strings.
    expect(stored).toMatchObject({ secondsStreamed: 1800, secondsWatched: 1800, peakViewers: 1 });

    const profile = await getProfile(db, visitor, "a");
    expect(profile).toMatchObject({
      username: "ana",
      stats: { hoursStreamed: 0.5, hoursWatched: 0.5, roomsHosted: 1, roomsJoined: 1 },
      coUsers: [{ id: "b", username: "bo", secondsTogether: 1800 }],
    });
    const found = await searchUsers(db, visitor, { query: "AN" });
    expect(found).toMatchObject([{ id: "a", stats: { hoursStreamed: 0.5, hoursWatched: 0.5 } }]);
  });

  it("purges an old ended room after rolling it up, and the stats outlive it", async () => {
    const old = at(-45 * 24 * 60);
    await endedRoom("old", old);
    expect(await purgeExpiredRooms(db, T0)).toEqual({ rolledUp: 1, purged: 1 });
    expect(await db.select({ id: rooms.id }).from(rooms)).toEqual([]);
    expect((await getProfile(db, visitor, "a"))?.stats.hoursStreamed).toBe(0.5);
  });

  it("creates a room with its tags and lists it", async () => {
    const { id } = await createRoom(db, asUser("a"), {
      name: "Late night",
      kind: "music",
      tags: ["lofi", "chill", "lofi"],
    });
    const [card] = await listLiveRooms(db, visitor);
    expect(card).toMatchObject({ id, name: "Late night", kind: "music", tags: ["lofi", "chill"] });
  });

  it("stores a thumbnail's bytes and reads them back unchanged (bytea)", async () => {
    const { id } = await createRoom(db, asUser("a"), { name: "Share", kind: "code", tags: [] });
    await db
      .insert(streamIntervals)
      .values({ roomId: id, userId: "a", startedAt: T0, lastSeenAt: T0 });
    const bytes = jpegHeader(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

    await uploadThumbnail(db, asUser("a"), { roomId: id, contentType: "image/jpeg", bytes }, T0);
    const read = await getThumbnail(db, visitor, id, "a", T0);
    expect(read?.mime).toBe("image/jpeg");
    expect(read?.capturedAt).toEqual(T0);
    expect([...(read?.image ?? [])]).toEqual([...bytes]);
  });

  it("round-trips a user's settings as jsonb", async () => {
    const settings = {
      theme: "light",
      accentHue: 30,
      radius: 4,
      density: "compact",
      layout: "mosaic",
      showChat: false,
    };
    expect(await saveUserSettings(db, "a", settings)).toEqual(settings);
    expect(await getUserSettings(db, "a")).toEqual(settings);
  });
});
