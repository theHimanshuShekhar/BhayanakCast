export interface ScheduledTask {
  cancel(): void
}

export interface Clock {
  now(): number
  scheduleAt(instant: number, task: () => void): ScheduledTask
}

export class SystemClock implements Clock {
  now() {
    return Date.now()
  }

  scheduleAt(instant: number, task: () => void): ScheduledTask {
    const timeout = setTimeout(task, Math.max(0, instant - this.now()))
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
