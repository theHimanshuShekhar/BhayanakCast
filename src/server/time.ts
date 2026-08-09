export interface ScheduledTask {
  cancel(): void
}

export interface Clock {
  now(): number
  scheduleAt(instant: number, task: () => void): ScheduledTask
}

/** Node clamps any `setTimeout` delay above 2^31-1 ms to 1 ms, so a deadline
    further out than ~24.8 days fires immediately and, because the deadline is
    still unmet, reschedules into a hot loop. Cap the wait instead and let the
    task re-arm from its own deadline check. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

export class SystemClock implements Clock {
  now() {
    return Date.now()
  }

  scheduleAt(instant: number, task: () => void): ScheduledTask {
    const wait = Number.isFinite(instant) ? instant - this.now() : 0
    const timeout = setTimeout(task, Math.min(MAX_TIMEOUT_MS, Math.max(0, wait)))
    return { cancel: () => clearTimeout(timeout) }
  }
}

type ControlledEntry = {
  instant: number
  sequence: number
  task: () => void
  cancelled: boolean
}

export class ControlledClock implements Clock {
  private current: number
  private sequence = 0
  private queue: ControlledEntry[] = []

  constructor(initial: number) {
    this.current = initial
  }

  now() {
    return this.current
  }

  scheduleAt(instant: number, task: () => void): ScheduledTask {
    const entry: ControlledEntry = {
      instant,
      sequence: this.sequence++,
      task,
      cancelled: false,
    }
    this.queue.push(entry)
    this.queue.sort(
      (left, right) =>
        left.instant - right.instant || left.sequence - right.sequence,
    )
    return {
      cancel() {
        entry.cancelled = true
      },
    }
  }

  advanceTo(instant: number) {
    if (instant < this.current) {
      throw new RangeError('cannot move clock backwards')
    }
    this.current = instant
    while (this.queue[0]?.instant <= instant) {
      const entry = this.queue.shift()!
      if (!entry.cancelled) entry.task()
    }
  }
}
