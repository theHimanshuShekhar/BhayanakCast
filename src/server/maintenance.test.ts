import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client.ts";
import { session, user } from "../db/schema/index.ts";
import { createTestDb } from "../db/test-db.ts";
import { purgeExpiredSessions, runMaintenance } from "./maintenance.ts";

const NOW = new Date("2026-10-02T12:00:00Z");
const HOUR = 60 * 60 * 1000;

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values({ id: "a", name: "a", email: "a@discord.invalid" });
  await db.insert(session).values([
    { id: "expired", token: "t1", userId: "a", expiresAt: new Date(NOW.getTime() - HOUR) },
    { id: "live", token: "t2", userId: "a", expiresAt: new Date(NOW.getTime() + HOUR) },
  ]);
});

afterEach(async () => {
  await close();
});

const sessionIds = async () => (await db.select({ id: session.id }).from(session)).map((s) => s.id);

describe("purgeExpiredSessions", () => {
  it("deletes expired sessions, keeps live ones, and returns the count", async () => {
    expect(await purgeExpiredSessions(db, NOW)).toBe(1);
    expect(await sessionIds()).toEqual(["live"]);
    expect(await purgeExpiredSessions(db, NOW)).toBe(0);
  });
});

describe("runMaintenance", () => {
  it("purges expired sessions in the daily job and logs the count", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runMaintenance(db, NOW);
      expect(await sessionIds()).toEqual(["live"]);
      expect(log).toHaveBeenCalledWith("[maintenance] sessions: deleted 1 expired session(s)");
    } finally {
      log.mockRestore();
    }
  });

  it("still purges sessions when the room purge throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await db.execute(sql`drop table rooms cascade`);
      await runMaintenance(db, NOW);
      expect(await sessionIds()).toEqual(["live"]);
      expect(error).toHaveBeenCalledWith("[maintenance] purge failed", expect.anything());
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
