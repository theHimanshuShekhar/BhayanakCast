/**
 * Time for the realtime server (ADR 12: server clock only). The room hub takes a `Clock`
 * instead of calling `Date` and `setTimeout`, so tests drive grace periods and idle timers
 * with `FakeClock` instead of waiting.
 */

export interface Timer {
  cancel(): void;
}

export interface Clock {
  now(): Date;
  /** Run `fn` once after `ms` milliseconds unless cancelled. */
  setTimer(ms: number, fn: () => void): Timer;
}

export const systemClock: Clock = {
  now: () => new Date(),
  setTimer(ms, fn) {
    const handle = setTimeout(fn, ms);
    // Timers never keep the process alive on their own.
    handle.unref?.();
    return { cancel: () => clearTimeout(handle) };
  },
};

interface PendingTimer {
  at: number;
  seq: number;
  fn: () => void;
}

/** A clock that only moves when told to. Timers fire during `advance`, in time order. */
export class FakeClock implements Clock {
  #now: number;
  #seq = 0;
  #timers = new Set<PendingTimer>();

  constructor(start: Date | string = "2026-09-01T12:00:00.000Z") {
    this.#now = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.#now);
  }

  setTimer(ms: number, fn: () => void): Timer {
    const timer: PendingTimer = { at: this.#now + Math.max(0, ms), seq: this.#seq++, fn };
    this.#timers.add(timer);
    return { cancel: () => this.#timers.delete(timer) };
  }

  /** Move time forward by `ms`, firing every timer that comes due, each at its own time. */
  advance(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      const next = [...this.#timers]
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      this.#timers.delete(next);
      this.#now = next.at;
      next.fn();
    }
    this.#now = target;
  }

  /** Timers not yet fired or cancelled. */
  get pendingTimers(): number {
    return this.#timers.size;
  }
}
