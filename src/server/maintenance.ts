/**
 * In-process maintenance scheduler: runs the retention purge (ADR 11) once on
 * boot and then every 24 hours. Single app process (ADR 9), so no locking.
 */
import type { Db } from "../db/client.ts";
import { purgeExpiredRooms } from "./stats.ts";

const INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startMaintenance(db: Db, intervalMs = INTERVAL_MS): { stop: () => void } {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await purgeExpiredRooms(db);
      console.log(
        `[maintenance] purge: rolled up ${result.rolledUp} room(s), deleted ${result.purged} expired room(s)`,
      );
    } catch (error) {
      console.error("[maintenance] purge failed", error);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
