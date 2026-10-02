/**
 * In-process maintenance scheduler: runs the retention purge (ADR 11) and the
 * expired-session purge once on boot and then every 24 hours. Single app
 * process (ADR 9), so no locking.
 */
import { lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { session } from "../db/schema/index.ts";
import { purgeExpiredRooms } from "./stats.ts";

const INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Delete Better Auth sessions past their expiry; returns how many went. */
export async function purgeExpiredSessions(db: Db, now: Date = new Date()): Promise<number> {
  const deleted = await db
    .delete(session)
    .where(lt(session.expiresAt, now))
    .returning({ id: session.id });
  return deleted.length;
}

/**
 * One maintenance pass. The two purges are independent: a failure in one is logged and doesn't
 * skip the other.
 */
export async function runMaintenance(db: Db, now: Date = new Date()): Promise<void> {
  try {
    const result = await purgeExpiredRooms(db, now);
    console.log(
      `[maintenance] purge: rolled up ${result.rolledUp} room(s), deleted ${result.purged} expired room(s)`,
    );
  } catch (error) {
    console.error("[maintenance] purge failed", error);
  }
  try {
    console.log(
      `[maintenance] sessions: deleted ${await purgeExpiredSessions(db, now)} expired session(s)`,
    );
  } catch (error) {
    console.error("[maintenance] session purge failed", error);
  }
}

export function startMaintenance(db: Db, intervalMs = INTERVAL_MS): { stop: () => void } {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runMaintenance(db);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
