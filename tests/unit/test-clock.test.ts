import { describe, expect, test, vi } from 'vitest'
import { SystemClock } from '../../src/server/time'
import { TestClock } from '../helpers/test-clock'

describe('Clock contract', () => {
  test('runs due tasks in deterministic time and insertion order', () => {
    const clock = new TestClock(100)
    const events: string[] = []

    clock.scheduleAt(150, () => events.push('first'))
    clock.scheduleAt(125, () => events.push('earlier'))
    clock.scheduleAt(150, () => events.push('second'))
    clock.advanceTo(150)

    expect(clock.now()).toBe(150)
    expect(events).toEqual(['earlier', 'first', 'second'])
  })

  test('cancels scheduled work and rejects backwards travel', () => {
    const clock = new TestClock(100)
    const task = vi.fn()
    const scheduled = clock.scheduleAt(125, task)

    scheduled.cancel()
    clock.advanceTo(125)

    expect(task).not.toHaveBeenCalled()
    expect(() => clock.advanceTo(124)).toThrow(RangeError)
  })

  test('binds the same contract to the system clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const clock = new SystemClock()
    const task = vi.fn()

    clock.scheduleAt(1_025, task)
    vi.advanceTimersByTime(25)

    expect(clock.now()).toBe(1_025)
    expect(task).toHaveBeenCalledOnce()
  })
})
