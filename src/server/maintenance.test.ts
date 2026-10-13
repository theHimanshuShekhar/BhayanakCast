import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client.ts";
import { qualitySamples, session, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { registerLiveHub } from "./live-hub.ts";
import { purgeExpiredSessions, runMaintenance } from "./maintenance.ts";
import type { RoomHub } from "./room-hub.ts";
import { type CapturedLogs, captureLogs } from "./test-logs.ts";

const NOW = new Date("2026-10-02T12:00:00Z");
const HOUR = 60 * 60 * 1000;

let db: Db;
let close: () => Promise<void>;
let logs: CapturedLogs;

beforeEach(async () => {
  logs = captureLogs();
  ({ db, close } = await createTestDb());
  await db.insert(user).values({ id: "a", name: "a", email: "a@discord.invalid" });
  await db.insert(session).values([
    { id: "expired", token: "t1", userId: "a", expiresAt: new Date(NOW.getTime() - HOUR) },
    { id: "live", token: "t2", userId: "a", expiresAt: new Date(NOW.getTime() + HOUR) },
  ]);
});

afterEach(async () => {
  logs.restore();
  await close();
});

const sessionIds = async () => (await db.select({ id: session.id }).from(session)).map((s) => s.id);

describe("purgeExpiredSessions", () => {
  it("deletes expired sessions, keeps live ones, and returns the count", async () => {
    expect(await purgeExpiredSessions(db, NOW)).toBe(1);
    expect(await sessionIds()).toEqual(["live"]);
    expect(await purgeExpiredSessions(db, NOW)).toBe(0);
  });

  it("tells the live hub about each purged session, and only those", async () => {
    await db.insert(session).values({
      id: "expired2",
      token: "t3",
      userId: "a",
      expiresAt: new Date(NOW.getTime() - HOUR),
    });
    const sessionEnded = vi.fn().mockResolvedValue(undefined);
    const unregister = registerLiveHub({ sessionEnded } as unknown as RoomHub);
    try {
      await purgeExpiredSessions(db, NOW);
    } finally {
      unregister();
    }
    expect(sessionEnded.mock.calls.map(([id]) => id).sort()).toEqual(["expired", "expired2"]);
  });

  it("purges with no live hub running", async () => {
    expect(await purgeExpiredSessions(db, NOW)).toBe(1);
  });
});

describe("runMaintenance", () => {
  it("purges expired sessions in the daily job and logs the count", async () => {
    await runMaintenance(db, NOW);
    expect(await sessionIds()).toEqual(["live"]);
    expect(logs.find("maintenance.sessions")).toMatchObject({
      level: "info",
      msg: "sessions: deleted 1 expired session(s)",
      deleted: 1,
    });
  });

  it("still purges sessions when the room purge throws", async () => {
    await db.execute(sql`drop table rooms cascade`);
    await runMaintenance(db, NOW);
    expect(await sessionIds()).toEqual(["live"]);
    expect(logs.find("maintenance.purge_failed")).toMatchObject({
      level: "error",
      err: expect.anything(),
    });
  });

  describe("quality samples (90 days, past the 30 of room data)", () => {
    const sampleAt = (id: string, daysOld: number) => ({
      roomId: id,
      roomKind: "chat" as const,
      at: new Date(NOW.getTime() - daysOld * 24 * HOUR),
      windowMs: 30_000,
      reporterUserId: "a",
      peerUserId: "b",
      direction: "send" as const,
      slot: "screen" as const,
      trigger: "window" as const,
      browser: "chrome" as const,
      browserMajor: 139,
    });
    const sampleRooms = async () =>
      (await db.select({ roomId: qualitySamples.roomId }).from(qualitySamples))
        .map((s) => s.roomId)
        .sort();

    it("purges them in the daily job, on their own cutoff", async () => {
      await db
        .insert(qualitySamples)
        .values([sampleAt("old", 91), sampleAt("past-30", 45), sampleAt("fresh", 1)]);
      await runMaintenance(db, NOW);
      expect(await sampleRooms()).toEqual(["fresh", "past-30"]);
      expect(logs.find("maintenance.quality")).toMatchObject({
        level: "info",
        msg: "quality: deleted 1 expired sample(s)",
        deleted: 1,
      });
    });

    it("still purges them when the room and session purges throw", async () => {
      await db.insert(qualitySamples).values(sampleAt("old", 91));
      await db.execute(sql`drop table rooms cascade`);
      await db.execute(sql`drop table session cascade`);
      await runMaintenance(db, NOW);
      expect(await sampleRooms()).toEqual([]);
      expect(logs.find("maintenance.purge_failed")).toMatchObject({ level: "error" });
      expect(logs.find("maintenance.sessions_failed")).toMatchObject({ level: "error" });
    });

    it("don't hold up the room and session purges when theirs throws", async () => {
      await db.execute(sql`drop table quality_samples`);
      await runMaintenance(db, NOW);
      expect(await sessionIds()).toEqual(["live"]);
      expect(logs.find("maintenance.quality_failed")).toMatchObject({ level: "error" });
      expect(logs.find("maintenance.purge")).toMatchObject({ level: "info" });
    });
  });
});
