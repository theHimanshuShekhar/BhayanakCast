/**
 * The room's snapshot for problem reports (ADR 4 addendum on problem reports), in memory.
 *
 * The first report in a room starts a snapshot, named by that report's id: the server asks every
 * browser in the room for theirs. Another report in the same room within `REPORT_SNAPSHOT_WINDOW_MS`
 * reuses it instead of asking again, so a room is asked at most once a minute. A browser may send
 * its snapshot for a while after the ask (`REPORT_SNAPSHOT_ACCEPT_MS`: the batch waits a few
 * seconds, and a failed send is retried), once per person; anything else is not a snapshot the
 * server asked for. A restart forgets them, so a snapshot sent after one is refused, as is one for
 * a report that was never made.
 */
import { REPORT_SNAPSHOT_ACCEPT_MS, REPORT_SNAPSHOT_WINDOW_MS } from "../lib/problem-report.ts";

interface Open {
  roomId: string;
  startedAt: number;
  /** Who has sent theirs. */
  from: Set<string>;
}

export class ReportSnapshots {
  readonly #open = new Map<string, Open>();
  /** The latest snapshot started in each room. */
  readonly #latest = new Map<string, string>();

  /** Snapshots still accepted. For tests. */
  get size(): number {
    return this.#open.size;
  }

  /**
   * The snapshot a report in `roomId` at `at` belongs to: the room's latest if it was started
   * within the window (`fresh: false`), else a new one named `reportId` (`fresh: true`, and the
   * caller asks the room for it).
   */
  open(roomId: string, reportId: string, at: Date): { snapshotId: string; fresh: boolean } {
    const now = at.getTime();
    this.#forget(now);
    const latest = this.#latest.get(roomId);
    const current = latest ? this.#open.get(latest) : undefined;
    if (latest && current && now - current.startedAt < REPORT_SNAPSHOT_WINDOW_MS) {
      return { snapshotId: latest, fresh: false };
    }
    this.#open.set(reportId, { roomId, startedAt: now, from: new Set() });
    this.#latest.set(roomId, reportId);
    return { snapshotId: reportId, fresh: true };
  }

  /**
   * Whether `userId`'s snapshot for `snapshotId` in `roomId` is wanted at `at`: the server asked
   * for it, in that room, it is still accepted and they haven't sent one. True takes their place.
   */
  claim(roomId: string, userId: string, snapshotId: string, at: Date): boolean {
    this.#forget(at.getTime());
    const open = this.#open.get(snapshotId);
    if (!open || open.roomId !== roomId || open.from.has(userId)) return false;
    open.from.add(userId);
    return true;
  }

  /** Give `userId`'s place back: their snapshot was claimed but not stored. */
  release(roomId: string, userId: string, snapshotId: string): void {
    const open = this.#open.get(snapshotId);
    if (open?.roomId === roomId) open.from.delete(userId);
  }

  #forget(now: number): void {
    for (const [id, open] of this.#open) {
      if (now - open.startedAt <= REPORT_SNAPSHOT_ACCEPT_MS) continue;
      this.#open.delete(id);
      if (this.#latest.get(open.roomId) === id) this.#latest.delete(open.roomId);
    }
  }
}

let snapshots: ReportSnapshots | undefined;

/** The server's snapshots, shared by the problem reports and the connection events. */
export function getReportSnapshots(): ReportSnapshots {
  snapshots ??= new ReportSnapshots();
  return snapshots;
}
