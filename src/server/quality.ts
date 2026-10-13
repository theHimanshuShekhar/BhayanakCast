/**
 * Video quality samples (ADR 2 and ADR 11 addendums), server half: what a page reports of the
 * video it sends and receives (`reportQualityFn`), and the daily purge after 90 days.
 *
 * A report is taken from a signed-in caller who is in the live room it names, and only for the
 * rows about peers who are in that room too (a peer who left since the page measured them is
 * dropped, and so is a row naming the caller themselves). Rows are dated by this server's clock
 * (ADR 12) and carry the room's kind, taken from the room, never from the page. Each user may
 * report only so many rows in a while, so one page can't fill the table.
 */
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { type Db, getDb } from "../db/client.ts";
import { presenceIntervals, qualitySamples, rooms } from "../db/schema/index.ts";
import {
  browserOf,
  type ReportQualityInput,
  reportQualityInput,
} from "../lib/quality-telemetry.ts";
import { type Caller, requireSignedIn } from "./caller.ts";
import { type Clock, systemClock } from "./clock.ts";
import { logReportDropped, timedWrite } from "./log-events.ts";
import { log } from "./logger.ts";
import { forgetIdle, withinRateLimit } from "./rate-limit.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long samples are kept (ADR 11 addendum): longer than room data. */
export const QUALITY_RETENTION_DAYS = 90;
/**
 * Rows reported per user in any `windowMs`; a report that would pass it is dropped whole. The
 * busiest honest page (nine peers, a share and a camera each way, so about 30 rows every 30
 * seconds) stores about 600 in this window, and a burst of rung changes adds a few more.
 */
export const QUALITY_ROW_RATE_LIMIT = { rows: 1_500, windowMs: 10 * 60_000 } as const;

/** What a report came to. */
export interface QualityReportResult {
  /** Rows stored. */
  stored: number;
}

export interface QualityServiceOptions {
  db: Db;
  clock?: Clock;
}

export class QualityService {
  readonly #db: Db;
  readonly #clock: Clock;
  /** When each user's rows were reported (epoch ms, oldest first, one entry per row). */
  readonly #sent = new Map<string, number[]>();

  constructor(options: QualityServiceOptions) {
    this.#db = options.db;
    this.#clock = options.clock ?? systemClock;
  }

  /**
   * Store the rows of `input` from the signed-in `caller`, whose browser said `userAgent`.
   * Nothing is stored for a caller who isn't in that live room, or who is over the rate limit.
   * The input is checked again here, as a server function's validator isn't the only way in.
   */
  async record(
    caller: Caller,
    input: ReportQualityInput,
    userAgent: string,
  ): Promise<QualityReportResult> {
    requireSignedIn(caller);
    const reporter = caller.user.id;
    const parsed = reportQualityInput.safeParse(input);
    if (!parsed.success) {
      const named = (input as { roomId?: unknown } | null)?.roomId;
      logReportDropped("quality", "invalid", {
        userId: reporter,
        roomId: typeof named === "string" ? named : undefined,
      });
      throw parsed.error;
    }
    const { roomId, samples } = parsed.data;
    const now = this.#clock.now();
    // A report within the allowance counts all its rows, before the room is looked at: rows that
    // turn out unauthorised (the caller or a peer isn't in the room) count though they aren't
    // stored. A report that would pass the allowance is refused whole, and counts nothing.
    const { rows: max, windowMs } = QUALITY_ROW_RATE_LIMIT;
    forgetIdle(this.#sent, windowMs, now);
    if (!withinRateLimit(this.#sent, reporter, max, windowMs, now, samples.length)) {
      logReportDropped("quality", "over_limit", {
        userId: reporter,
        roomId,
        rows: samples.length,
      });
      return { stored: 0 };
    }

    const peers = [...new Set(samples.map((s) => s.peerId))].filter((id) => id !== reporter);
    // Who is in the live room now, among the reporter and the peers named.
    const present = await this.#db
      .select({ userId: presenceIntervals.userId, kind: rooms.kind })
      .from(presenceIntervals)
      .innerJoin(rooms, eq(rooms.id, presenceIntervals.roomId))
      .where(
        and(
          eq(presenceIntervals.roomId, roomId),
          isNull(presenceIntervals.endedAt),
          isNull(rooms.endedAt),
          inArray(presenceIntervals.userId, [reporter, ...peers]),
        ),
      );
    const inRoom = new Set(present.map((p) => p.userId));
    const kind = present[0]?.kind;
    if (!kind || !inRoom.has(reporter)) {
      logReportDropped("quality", "not_in_room", {
        userId: reporter,
        roomId,
        rows: samples.length,
      });
      return { stored: 0 };
    }

    const browser = browserOf(userAgent);
    const rows = samples
      .filter((s) => inRoom.has(s.peerId) && s.peerId !== reporter)
      .map(({ peerId, ageMs, reason, ...sample }) => ({
        ...sample,
        roomId,
        roomKind: kind,
        at: new Date(now.getTime() - ageMs),
        reporterUserId: reporter,
        peerUserId: peerId,
        rungReason: reason,
        browser: browser.name,
        browserMajor: browser.major,
      }));
    const droppedRows = samples.length - rows.length;
    if (droppedRows > 0) {
      // Rows about a peer who left since the page measured them, or about the reporter themselves.
      logReportDropped("quality", "peer_not_in_room", {
        userId: reporter,
        roomId,
        rows: droppedRows,
      });
    }
    if (rows.length === 0) return { stored: 0 };
    const who = { userId: reporter, roomId, rows: rows.length };
    try {
      await timedWrite("quality.insert", () => this.#db.insert(qualitySamples).values(rows), who);
    } catch (error) {
      log.error("quality.write_failed", "storing quality samples failed", { ...who, err: error });
      throw error;
    }
    return { stored: rows.length };
  }
}

let service: QualityService | undefined;

/** The server's `QualityService`. */
export function getQualityService(): QualityService {
  service ??= new QualityService({ db: getDb() });
  return service;
}

/** Delete samples older than `QUALITY_RETENTION_DAYS`; returns how many went. */
export async function purgeExpiredQualitySamples(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - QUALITY_RETENTION_DAYS * DAY_MS);
  const deleted = await db
    .delete(qualitySamples)
    .where(lt(qualitySamples.at, cutoff))
    .returning({ id: qualitySamples.id });
  return deleted.length;
}
