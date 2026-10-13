/**
 * Getting a page's connection events to the server (ADR 3 addendum on the room timeline). They
 * go over a server function in batches, like the quality telemetry (./quality-telemetry.ts) and
 * for the same reasons: the room socket's serial queue is for signalling, and these must get
 * through while the socket is reconnecting. Unlike quality rows they are not disposable (they are
 * the evidence of a bad connection), so:
 *
 * - Events wait `CONNECTION_FLUSH_DELAY_MS` for company, then go out in reports of at most
 *   `CONNECTION_BATCH_MAX` events, one room per report.
 * - A report that fails keeps its events queued, ahead of newer ones, to be sent with the next
 *   batch (or by itself after `CONNECTION_RETRY_DELAY_MS` if nothing new comes). The queue holds
 *   the newest `CONNECTION_QUEUE_MAX` events: when it is over, the oldest go.
 * - When the page closes, what is queued goes out with `sendBeacon` (`flushOnClose`), which the
 *   browser finishes after the page is gone. A beacon is a same-origin POST, so the browser sends
 *   the session cookie with it (see src/routes/api/connection-events.ts).
 *
 * Every event is stamped with the room it happened in: the one the page is in or joining
 * (`setRoom`), so a device error in the lobby counts against the room about to be entered.
 */
import {
  CONNECTION_BATCH_MAX,
  type ConnectionEvent,
  MAX_EVENT_AGE_MS,
  type ReportConnectionEventsInput,
} from "./connection-events";

/** Events wait this long for company before they go out. */
export const CONNECTION_FLUSH_DELAY_MS = 3_000;
/** A failed report is tried again this long after, if no new event brings the next batch sooner. */
export const CONNECTION_RETRY_DELAY_MS = 30_000;
/** Events kept while reports fail; the oldest go first. */
export const CONNECTION_QUEUE_MAX = 200;

interface Queued {
  roomId: string;
  /** Epoch milliseconds. */
  at: number;
  event: ConnectionEvent;
}

export interface ConnectionReporterOptions {
  /** Sends one report (`reportConnectionFn`); rejects if it fails. */
  send: (report: ReportConnectionEventsInput) => Promise<unknown>;
  /** Hands a report to `navigator.sendBeacon`; false if the browser did not take it. */
  beacon: (report: ReportConnectionEventsInput) => boolean;
  /** Where a failed report is noted. Defaults to `console.warn`. */
  log?: (message: string, error?: unknown) => void;
  now?: () => number;
}

export class ConnectionReporter {
  readonly #options: ConnectionReporterOptions;
  #queue: Queued[] = [];
  #room: string | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #timerAt = 0;
  /** Sends run one after another, so a retry never overtakes the report before it. */
  #chain: Promise<void> = Promise.resolve();

  constructor(options: ConnectionReporterOptions) {
    this.#options = options;
  }

  /** Events waiting to be sent. */
  get queued(): number {
    return this.#queue.length;
  }

  /** The room this page is in or joining (null: none; events outside a room are dropped). */
  setRoom(roomId: string | null): void {
    this.#room = roomId;
  }

  /** Queue `event` for `roomId` (default: the room this page is in or joining). */
  add(event: ConnectionEvent, roomId: string | null = this.#room): void {
    if (!roomId) return;
    this.#queue.push({ roomId, at: this.#now(), event });
    this.#trim();
    this.#arm(CONNECTION_FLUSH_DELAY_MS);
  }

  /** Send everything queued now. A report that fails stops it, and its events stay queued. */
  flush(): Promise<void> {
    this.#disarm();
    this.#chain = this.#chain.then(() => this.#drain());
    return this.#chain;
  }

  /** The page is closing: give everything queued to the beacon, whatever the timers say. */
  flushOnClose(): void {
    this.#disarm();
    while (this.#queue.length > 0) {
      const batch = this.#take();
      if (!this.#options.beacon(this.#report(batch))) {
        this.#queue.unshift(...batch);
        return;
      }
    }
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  async #drain(): Promise<void> {
    const { send, log = (m, e) => console.warn(`[connection] ${m}`, e) } = this.#options;
    while (this.#queue.length > 0) {
      const batch = this.#take();
      try {
        await send(this.#report(batch));
      } catch (error) {
        log("reporting failed; will try again", error);
        // Ahead of anything queued meanwhile, and the newest are the ones kept.
        this.#queue.unshift(...batch);
        this.#trim();
        this.#arm(CONNECTION_RETRY_DELAY_MS);
        return;
      }
    }
  }

  /** The next report's events: up to a batch of the oldest queued, all of one room. */
  #take(): Queued[] {
    const roomId = (this.#queue[0] as Queued).roomId;
    const taken: Queued[] = [];
    const rest: Queued[] = [];
    for (const queued of this.#queue) {
      (queued.roomId === roomId && taken.length < CONNECTION_BATCH_MAX ? taken : rest).push(queued);
    }
    this.#queue = rest;
    return taken;
  }

  #report(batch: Queued[]): ReportConnectionEventsInput {
    const now = this.#now();
    return {
      roomId: (batch[0] as Queued).roomId,
      events: batch.map(({ at, event }) => ({
        ...event,
        ageMs: Math.min(MAX_EVENT_AGE_MS, Math.max(0, Math.round(now - at))),
      })),
    };
  }

  #trim(): void {
    const over = this.#queue.length - CONNECTION_QUEUE_MAX;
    if (over > 0) this.#queue.splice(0, over);
  }

  /** Flush in `delay`, unless a flush is already due sooner. */
  #arm(delay: number): void {
    const due = this.#now() + delay;
    if (this.#timer && this.#timerAt <= due) return;
    clearTimeout(this.#timer);
    this.#timerAt = due;
    this.#timer = setTimeout(() => void this.flush(), delay);
  }

  #disarm(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
