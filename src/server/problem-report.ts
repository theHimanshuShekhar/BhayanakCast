/**
 * Problem reports (CONTEXT.md; ADR 4 addendum on problem reports), server half: someone in a room
 * flags a moment as going wrong (`reportProblemFn`), and it becomes rows of the room timeline
 * (./room-timeline.ts) that only admins read (./admin-reports.ts, ./admin-timeline.ts).
 *
 * A report is taken from a signed-in caller who is in the live room, and then:
 * - **One per person per minute** (`REPORT_PERSON_WINDOW_MS`, across rooms). A second one inside
 *   it is refused `too_soon`, with how long to wait; a refusal doesn't start the minute.
 * - **A `problem_report` row**: the reporter as actor, the stream's owner (when it was sent from
 *   that stream's quality modal and they are in the room) as target, and in `details` the report's
 *   `reportId`, `category`, the note (trimmed, cleaned like a connection event's error message and
 *   cut to `PROBLEM_NOTE_MAX`) and `snapshot`: the id of the room's snapshot it belongs to. The
 *   note is for admins on the timeline only: the server log gets its length, not its text
 *   (`logTimelineRow`).
 * - **The reporter's own snapshot**, sent with the report, as a `report_snapshot` row under the
 *   report's own id.
 * - **The room is asked for theirs** (`ask`, the hub's `snapshot.request`), unless a snapshot was
 *   started in the room within `REPORT_SNAPSHOT_WINDOW_MS`: then the report points at that one
 *   (`snapshot` is its id, `reused: true`). Others' snapshots arrive as connection events
 *   (./connection-events.ts), each tied by `reportId` to the snapshot that was asked for.
 * Nothing here reaches the room or its feed.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { type Db, getDb } from "../db/client.ts";
import { presenceIntervals, rooms, roomTimelineEvents } from "../db/schema/index.ts";
import { cleanMessage } from "../lib/connection-events.ts";
import {
  MAX_REPORT_DETAILS_BYTES,
  PROBLEM_NOTE_MAX,
  PROBLEM_REPORT_KEEP,
  REPORT_PERSON_WINDOW_MS,
  type ReportProblemInput,
  reportProblemInput,
} from "../lib/problem-report.ts";
import { boundDetails, type TimelineDetails, type TimelineEventRow } from "../lib/room-timeline.ts";
import { type Caller, requireSignedIn } from "./caller.ts";
import { type Clock, systemClock } from "./clock.ts";
import { getLiveHub } from "./live-hub.ts";
import {
  logReportDropped,
  logTimelineRow,
  logTimelineWriteFailed,
  timedWrite,
} from "./log-events.ts";
import { log } from "./logger.ts";
import { getReportSnapshots, type ReportSnapshots, snapshotDetails } from "./report-snapshots.ts";

/** What a report came to. */
export type ProblemReportResult =
  /** Recorded. `snapshotId` is the snapshot it belongs to, `reused` if an earlier report's. */
  | { status: "sent"; snapshotId: string; reused: boolean }
  /** This person reported less than a minute ago; try again in `retryInMs`. */
  | { status: "too_soon"; retryInMs: number }
  | { status: "not_in_room" };

export interface ProblemReportServiceOptions {
  db: Db;
  clock?: Clock;
  snapshots?: ReportSnapshots;
  /** Ask everyone in `roomId` but `exceptUserId` for their snapshot `snapshotId`. */
  ask?: (roomId: string, snapshotId: string, exceptUserId: string) => unknown;
  newId?: () => string;
}

export class ProblemReportService {
  readonly #db: Db;
  readonly #clock: Clock;
  readonly #snapshots: ReportSnapshots;
  readonly #ask: NonNullable<ProblemReportServiceOptions["ask"]>;
  readonly #newId: () => string;
  /** When each person's last report was taken (epoch ms). */
  readonly #last = new Map<string, number>();

  constructor(options: ProblemReportServiceOptions) {
    this.#db = options.db;
    this.#clock = options.clock ?? systemClock;
    this.#snapshots = options.snapshots ?? getReportSnapshots();
    this.#ask =
      options.ask ??
      ((roomId, snapshotId, exceptUserId) =>
        getLiveHub()?.requestSnapshots(roomId, snapshotId, exceptUserId));
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** Record `input` from the signed-in `caller`. Throws for a malformed form or a write that failed. */
  async report(caller: Caller, input: ReportProblemInput): Promise<ProblemReportResult> {
    requireSignedIn(caller);
    const reporter = caller.user.id;
    const parsed = reportProblemInput.safeParse(input);
    if (!parsed.success) {
      const named = (input as { roomId?: unknown } | null)?.roomId;
      logReportDropped("problem", "invalid", {
        userId: reporter,
        roomId: typeof named === "string" ? named : undefined,
      });
      throw parsed.error;
    }
    const { roomId, category, note, streamUserId, snapshot } = parsed.data;
    const now = this.#clock.now();

    const present = await this.#inRoom(roomId, [reporter, ...(streamUserId ? [streamUserId] : [])]);
    if (!present.has(reporter)) {
      logReportDropped("problem", "not_in_room", { userId: reporter, roomId });
      return { status: "not_in_room" };
    }
    const earlier = this.#last.get(reporter);
    if (earlier !== undefined && now.getTime() - earlier < REPORT_PERSON_WINDOW_MS) {
      logReportDropped("problem", "over_limit", { userId: reporter, roomId });
      return {
        status: "too_soon",
        retryInMs: REPORT_PERSON_WINDOW_MS - (now.getTime() - earlier),
      };
    }
    for (const [who, at] of this.#last) {
      if (now.getTime() - at >= REPORT_PERSON_WINDOW_MS) this.#last.delete(who);
    }
    this.#last.set(reporter, now.getTime());

    // A note of nothing but control characters is no note.
    const cleaned = note ? cleanMessage(note, [], PROBLEM_NOTE_MAX) : undefined;
    const reportId = this.#newId();
    const { snapshotId, fresh } = this.#snapshots.open(roomId, reportId, now, reporter);
    // Asked before the write: the moment matters more than the row, and if the write fails the
    // retry (inside the minute) points at this snapshot.
    if (fresh) this.#askRoom(roomId, snapshotId, reporter);

    const row = (kind: TimelineEventRow["kind"], target: string | null, details: TimelineDetails) =>
      ({
        roomId,
        at: now,
        kind,
        actorUserId: reporter,
        targetUserId: target,
        details,
      }) satisfies TimelineEventRow;
    const rows = [
      row(
        "problem_report",
        streamUserId && present.has(streamUserId) ? streamUserId : null,
        boundDetails(
          {
            reportId,
            category,
            ...(cleaned && { note: cleaned }),
            snapshot: snapshotId,
            ...(!fresh && { reused: true }),
          },
          MAX_REPORT_DETAILS_BYTES,
          PROBLEM_REPORT_KEEP,
        ),
      ),
      row("report_snapshot", null, snapshotDetails({ reportId, ...snapshot })),
    ];
    try {
      await timedWrite(
        "problem_report.insert",
        () => this.#db.insert(roomTimelineEvents).values(rows),
        { userId: reporter, roomId },
      );
    } catch (error) {
      // The allowance is for a report that was stored: give it back so a retry can have it.
      if (this.#last.get(reporter) === now.getTime()) {
        if (earlier === undefined) this.#last.delete(reporter);
        else this.#last.set(reporter, earlier);
      }
      logTimelineWriteFailed(
        error,
        { userId: reporter, roomId },
        "storing a problem report failed",
      );
      throw error;
    }
    for (const stored of rows) logTimelineRow(stored);
    return { status: "sent", snapshotId, reused: !fresh };
  }

  /** Who of `userIds` is in the live room `roomId` now. */
  async #inRoom(roomId: string, userIds: string[]): Promise<Set<string>> {
    const found = await this.#db
      .select({ userId: presenceIntervals.userId })
      .from(presenceIntervals)
      .innerJoin(rooms, eq(rooms.id, presenceIntervals.roomId))
      .where(
        and(
          eq(presenceIntervals.roomId, roomId),
          isNull(presenceIntervals.endedAt),
          isNull(rooms.endedAt),
          inArray(presenceIntervals.userId, userIds),
        ),
      );
    return new Set(found.map((f) => f.userId));
  }

  /** The ask never makes the report fail: the report is the thing worth keeping. */
  #askRoom(roomId: string, snapshotId: string, exceptUserId: string): void {
    const failed = (error: unknown) =>
      log.error("problem.ask_failed", "asking the room for snapshots failed", {
        roomId,
        snapshotId,
        err: error,
      });
    try {
      void Promise.resolve(this.#ask(roomId, snapshotId, exceptUserId)).catch(failed);
    } catch (error) {
      failed(error);
    }
  }
}

let service: ProblemReportService | undefined;

/** The server's `ProblemReportService`. */
export function getProblemReportService(): ProblemReportService {
  service ??= new ProblemReportService({ db: getDb() });
  return service;
}
