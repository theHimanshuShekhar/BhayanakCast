/**
 * In-process maintenance scheduler: runs the retention purge (ADR 11), the expired-session
 * purge, the 90-day quality sample purge and the 90-day room timeline purge once on boot and
 * then every 24 hours. Single app process (ADR 9), so no locking.
 */
import { lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { session } from "../db/schema/index.ts";
import { getLiveHub } from "./live-hub.ts";
import { log } from "./logger.ts";
import { purgeExpiredQualitySamples } from "./quality.ts";
import { purgeExpiredTimelineEvents } from "./room-timeline.ts";
import { purgeExpiredRooms } from "./stats.ts";

const INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Delete Better Auth sessions past their expiry; returns how many went. The rows go straight
 * through Drizzle, not Better Auth's session-delete hook (src/lib/auth.ts), so the live hub is
 * told here: a socket still open on one of them closes.
 */
export async function purgeExpiredSessions(db: Db, now: Date = new Date()): Promise<number> {
  const deleted = await db
    .delete(session)
    .where(lt(session.expiresAt, now))
    .returning({ id: session.id });
  const hub = getLiveHub();
  if (hub) await Promise.all(deleted.map(({ id }) => hub.sessionEnded(id)));
  return deleted.length;
}

/**
 * One maintenance pass. The purges are independent: a failure in one is logged and doesn't
 * skip the others. The quality samples and the room timeline outlive the room purge (90 days to
 * its 30), so each has a purge of its own.
 */
export async function runMaintenance(db: Db, now: Date = new Date()): Promise<void> {
  try {
    const result = await purgeExpiredRooms(db, now);
    log.info(
      "maintenance.purge",
      `purge: rolled up ${result.rolledUp} room(s), deleted ${result.purged} expired room(s)`,
      { rolledUp: result.rolledUp, deleted: result.purged },
    );
  } catch (error) {
    log.error("maintenance.purge_failed", "purge failed", { err: error });
  }
  try {
    const deleted = await purgeExpiredSessions(db, now);
    log.info("maintenance.sessions", `sessions: deleted ${deleted} expired session(s)`, {
      deleted,
    });
  } catch (error) {
    log.error("maintenance.sessions_failed", "session purge failed", { err: error });
  }
  try {
    const deleted = await purgeExpiredQualitySamples(db, now);
    log.info("maintenance.quality", `quality: deleted ${deleted} expired sample(s)`, { deleted });
  } catch (error) {
    log.error("maintenance.quality_failed", "quality sample purge failed", { err: error });
  }
  try {
    const deleted = await purgeExpiredTimelineEvents(db, now);
    log.info("maintenance.timeline", `timeline: deleted ${deleted} expired event(s)`, { deleted });
  } catch (error) {
    log.error("maintenance.timeline_failed", "timeline purge failed", { err: error });
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
