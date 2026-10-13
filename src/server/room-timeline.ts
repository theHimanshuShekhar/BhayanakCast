/**
 * The room timeline's write side (CONTEXT.md; ADR 4 addendum on the write path, ADR 11 addendum on what is kept): the hub reports what
 * happens in a room to a `TimelineSink` and carries on; `TimelineRecorder` queues it and writes
 * it to `room_timeline_events` in batches, off the hub's critical path.
 *
 * - `record` and `refused` only push onto a bounded in-memory queue: they never wait for, or
 *   throw because of, the database. The queue is written `flushDelayMs` later, `batchSize` rows
 *   at a time, one write at a time.
 * - A write that fails, or takes longer than `writeTimeoutMs`, is logged and its rows go back to
 *   the front of the queue, retried after a backoff (`RETRY_BASE_MS` doubling to `RETRY_MAX_MS`).
 *   There is never more than one write in flight and no timer is armed while there is one, so a
 *   write that hangs holds up nothing else and piles up nothing. While the database is down or
 *   slow the queue holds at `maxQueued`: the oldest events are dropped, counted (`dropped`) and
 *   logged. A write given up on may still land later, so its retry can store its rows twice.
 * - `rate_limited` and `bad_request` refusals are tallied in memory and written as one `refusals`
 *   row per person, room and minute, once the minute is over.
 * - Chat content is never recorded: callers pass kinds, ids and small details only.
 * - Each event `record` takes is also logged at info as `timeline.<kind>` (./log-events.ts), so the
 *   server log can be searched across rooms and users. The log never throws into the caller, and
 *   write failures, timeouts and drops are logged too (`timeline.write_failed`, `timeline.dropped`).
 *
 * Read side: ./admin-timeline.ts. Retention: `purgeExpiredTimelineEvents`, a daily step of its own.
 */
import { lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { roomTimelineEvents } from "../db/schema/index.ts";
import {
  boundDetails,
  MAX_REFUSAL_KEYS,
  type SummarisedRefusal,
  TIMELINE_RETENTION_DAYS,
  type TimelineEventRow,
} from "../lib/room-timeline.ts";
import { type Clock, systemClock, type Timer } from "./clock.ts";
import { logTimelineRow, logTimelineWriteFailed, timedWrite } from "./log-events.ts";
import { log } from "./logger.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

/**
 * Where the hub reports what happens in a room. `record` and `refused` never wait, throw or
 * touch the db; `flush` and `close` are for tests and shutdown.
 */
export interface TimelineSink {
  record(event: TimelineEventRow): void;
  /** `userId`'s message `messageType` in `roomId` was refused with `reason` at `at`. */
  refused(
    roomId: string,
    userId: string,
    messageType: string,
    reason: SummarisedRefusal,
    at: Date,
  ): void;
  /** Write what is queued now (and the refusal minutes that are over); never rejects. */
  flush(): Promise<void>;
  /** Shutdown: write everything, the open minute too, and stop. Gives up on a stuck write. */
  close(): Promise<void>;
}

/** Records nothing; a hub built without a timeline (most tests) uses it. */
export const noTimeline: TimelineSink = {
  record: () => {},
  refused: () => {},
  flush: async () => {},
  close: async () => {},
};

/** Tuning for `TimelineRecorder`; the defaults are production's. */
export interface TimelineRecorderTuning {
  /** How long after an event it is written, so events arriving together share a write. */
  flushDelayMs?: number;
  /** The most rows in one write. */
  batchSize?: number;
  /** The most events waiting to be written; past it the oldest are dropped. */
  maxQueued?: number;
  /** How long one write may take before it counts as failed. */
  writeTimeoutMs?: number;
}

export const TIMELINE_FLUSH_DELAY_MS = 2_000;
export const TIMELINE_BATCH_SIZE = 200;
/** A busy hour of a full room is a few thousand events; this holds minutes of a dead database. */
export const TIMELINE_MAX_QUEUED = 5_000;
/** One write takes longer than this (real time) and it's given up on. */
export const TIMELINE_WRITE_TIMEOUT_MS = 10_000;
/** A failed write is tried again after `RETRY_BASE_MS`, then twice as long each time. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** Dropped events are logged at most this often. */
const DROP_LOG_EVERY_MS = 60_000;
/** `close` waits this long for a write, so a stuck database can't hold up shutdown (ADR 9). */
export const TIMELINE_CLOSE_TIMEOUT_MS = 3_000;

export interface TimelineRecorderDeps {
  clock?: Clock;
  /** Write one batch; a rejection (or throw) is a failed write. */
  write: (rows: TimelineEventRow[]) => Promise<unknown>;
  options?: TimelineRecorderTuning;
}

/** One person's refusals in one room in one minute. */
interface Tally {
  roomId: string;
  userId: string;
  /** The minute's start, epoch ms. */
  minute: number;
  counts: Record<string, number>;
}

export class TimelineRecorder implements TimelineSink {
  readonly #clock: Clock;
  readonly #write: TimelineRecorderDeps["write"];
  readonly #flushDelayMs: number;
  readonly #batchSize: number;
  readonly #maxQueued: number;
  readonly #writeTimeoutMs: number;
  /** Waiting to be written, oldest first. */
  #queue: TimelineEventRow[] = [];
  readonly #tallies = new Map<string, Tally>();
  #dropped = 0;
  #lastDropLog = Number.NEGATIVE_INFINITY;
  /** Writes in a row that failed; sets the wait before the next try. */
  #failures = 0;
  /** The armed timer, and when (epoch ms) it fires. */
  #timer: Timer | undefined;
  #timerAt = 0;
  #stopped = false;
  /** The drain in flight, if any: only one runs at a time. */
  #active: Promise<void> | undefined;
  /** The one drain waiting for it to finish, and whether it is the final one. */
  #followUp: Promise<void> | undefined;
  #followUpFinal = false;

  constructor(deps: TimelineRecorderDeps) {
    this.#clock = deps.clock ?? systemClock;
    this.#write = deps.write;
    this.#flushDelayMs = deps.options?.flushDelayMs ?? TIMELINE_FLUSH_DELAY_MS;
    this.#batchSize = deps.options?.batchSize ?? TIMELINE_BATCH_SIZE;
    this.#maxQueued = deps.options?.maxQueued ?? TIMELINE_MAX_QUEUED;
    this.#writeTimeoutMs = deps.options?.writeTimeoutMs ?? TIMELINE_WRITE_TIMEOUT_MS;
  }

  /** Events waiting to be written (a batch being written is not counted). */
  get queued(): number {
    return this.#queue.length;
  }

  /** Events dropped for want of room in the queue, since boot. */
  get dropped(): number {
    return this.#dropped;
  }

  record(event: TimelineEventRow): void {
    const row = { ...event, details: boundDetails(event.details) };
    this.#push(row);
    this.#schedule();
    // After the event is safely queued, and never a reason for the caller to hear of a failure.
    logTimelineRow(row);
  }

  refused(
    roomId: string,
    userId: string,
    messageType: string,
    reason: SummarisedRefusal,
    at: Date,
  ): void {
    const minute = at.getTime() - (at.getTime() % MINUTE_MS);
    const id = `${roomId}\0${userId}\0${minute}`;
    let tally = this.#tallies.get(id);
    if (!tally) {
      if (this.#tallies.size >= this.#maxQueued) {
        this.#drop(1);
        return;
      }
      tally = { roomId, userId, minute, counts: {} };
      this.#tallies.set(id, tally);
    }
    // Message types come from the client (an unparseable frame names its own), so cap them.
    const key = `${messageType.slice(0, 40)}:${reason}`;
    const counted = key in tally.counts || Object.keys(tally.counts).length < MAX_REFUSAL_KEYS;
    const counts = tally.counts;
    const slot = counted ? key : `other:${reason}`;
    counts[slot] = (counts[slot] ?? 0) + 1;
    this.#schedule();
  }

  /**
   * Write what is queued now, with the minutes of refusals that are over. A failed write is
   * logged and leaves its rows queued; this resolves either way.
   */
  flush(): Promise<void> {
    return this.#run(false);
  }

  async close(): Promise<void> {
    this.#stopped = true;
    this.#timer?.cancel();
    this.#timer = undefined;
    const written = this.#run(true);
    await new Promise<void>((resolve) => {
      const giveUp = this.#clock.setTimer(TIMELINE_CLOSE_TIMEOUT_MS, () => {
        logTimelineWriteFailed(
          undefined,
          { queued: this.#queue.length },
          "closing the room timeline timed out; events still queued are lost",
        );
        resolve();
      });
      void written.then(() => {
        giveUp.cancel();
        resolve();
      });
    });
  }

  /**
   * Drain the queue. With a drain in flight, wait for it and then drain once more: all callers
   * share that one follow-up (final if any of them wants it), so nothing stacks up behind a write
   * that hangs.
   */
  #run(final: boolean): Promise<void> {
    if (this.#active) {
      this.#followUpFinal ||= final;
      this.#followUp ??= this.#active.then(() => {
        const wantFinal = this.#followUpFinal;
        this.#followUp = undefined;
        this.#followUpFinal = false;
        return this.#run(wantFinal);
      });
      return this.#followUp;
    }
    const drain = this.#drain(final).finally(() => {
      if (this.#active === drain) this.#active = undefined;
      this.#schedule();
    });
    this.#active = drain;
    return drain;
  }

  #push(row: TimelineEventRow): void {
    this.#queue.push(row);
    this.#trim();
  }

  /** Hold the queue to its bound, dropping the oldest. */
  #trim(): void {
    const over = this.#queue.length - this.#maxQueued;
    if (over <= 0) return;
    this.#queue.splice(0, over);
    this.#drop(over);
  }

  #drop(count: number): void {
    this.#dropped += count;
    const now = this.#clock.now().getTime();
    if (now - this.#lastDropLog < DROP_LOG_EVERY_MS) return;
    this.#lastDropLog = now;
    log.warn("timeline.dropped", "room timeline queue is full: dropping the oldest events", {
      dropped: this.#dropped,
      max: this.#maxQueued,
    });
  }

  /**
   * Make sure a timer is armed for the earliest time something needs writing: queued events (the
   * flush delay, or the backoff after a failure) or an open minute of refusals (its end). A timer
   * armed for later is replaced. None is armed while a drain is in flight (it re-arms when done).
   */
  #schedule(): void {
    if (this.#stopped || this.#active) return;
    const now = this.#clock.now().getTime();
    let at: number;
    if (this.#failures > 0) {
      at = now + Math.min(RETRY_BASE_MS * 2 ** (this.#failures - 1), RETRY_MAX_MS);
    } else if (this.#queue.length > 0) {
      at = now + this.#flushDelayMs;
    } else if (this.#tallies.size > 0) {
      at = Math.min(...[...this.#tallies.values()].map((t) => t.minute)) + MINUTE_MS;
    } else return;
    if (this.#timer && this.#timerAt <= at) return;
    this.#timer?.cancel();
    this.#timerAt = at;
    this.#timer = this.#clock.setTimer(Math.max(at - now, 0), () => {
      this.#timer = undefined;
      // A drain already running re-arms the timer when it ends.
      if (!this.#active) void this.#run(false);
    });
  }

  /** Turn the tallied minutes that are over (all, if `final`) into queued `refusals` rows. */
  #closeTallies(final: boolean): void {
    const now = this.#clock.now().getTime();
    for (const [id, tally] of this.#tallies) {
      if (!final && tally.minute + MINUTE_MS > now) continue;
      this.#tallies.delete(id);
      this.#push({
        roomId: tally.roomId,
        at: new Date(tally.minute),
        kind: "refusals",
        actorUserId: tally.userId,
        targetUserId: null,
        details: boundDetails({ counts: tally.counts }),
      });
    }
  }

  async #drain(final: boolean): Promise<void> {
    this.#closeTallies(final);
    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, this.#batchSize);
      try {
        await this.#timedWrite(batch);
        this.#failures = 0;
      } catch (error) {
        this.#failures++;
        logTimelineWriteFailed(
          error,
          { tries: this.#failures, kept: batch.length },
          `writing room timeline events failed (try ${this.#failures}); ${batch.length} kept`,
        );
        // Back at the front, ahead of anything recorded meanwhile.
        this.#queue.unshift(...batch);
        this.#trim();
        break;
      }
    }
  }

  /**
   * Write `batch`, failing if it takes longer than `writeTimeoutMs`. That is how long the
   * database really took, so it runs on a real timer, not the injected `Clock` (which tests move
   * in leaps while a write is in flight).
   */
  async #timedWrite(batch: TimelineEventRow[]): Promise<void> {
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#write(batch),
        new Promise<never>((_, reject) => {
          giveUp = setTimeout(
            () => reject(new Error(`the write timed out after ${this.#writeTimeoutMs} ms`)),
            this.#writeTimeoutMs,
          );
          giveUp.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(giveUp);
    }
  }
}

/** A recorder writing to `db` (batches go in as one insert). */
export function createTimelineRecorder(db: Db, clock: Clock = systemClock): TimelineRecorder {
  return new TimelineRecorder({
    clock,
    write: (rows) =>
      timedWrite("timeline.insert", () => db.insert(roomTimelineEvents).values(rows), {
        rows: rows.length,
      }),
  });
}

/** Delete events older than `TIMELINE_RETENTION_DAYS`; returns how many went. */
export async function purgeExpiredTimelineEvents(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TIMELINE_RETENTION_DAYS * DAY_MS);
  const deleted = await db
    .delete(roomTimelineEvents)
    .where(lt(roomTimelineEvents.at, cutoff))
    .returning({ id: roomTimelineEvents.id });
  return deleted.length;
}
