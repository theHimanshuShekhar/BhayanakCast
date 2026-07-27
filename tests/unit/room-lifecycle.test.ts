import type Redis from 'ioredis'
import type { Pool } from 'pg'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { RoomLifecycle } from '../../src/server/rooms/room-lifecycle'
import { RoomService } from '../../src/server/rooms/room-service'
import { TestClock } from '../helpers/test-clock'

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})


describe('room lifecycle recovery', () => {
  test('retries initial recovery before becoming ready', async () => {
    vi.useFakeTimers()
    const clock = new TestClock(1_000)
    let available = false
    const pool = {
      query: vi.fn(async () => {
        if (!available) throw new Error('database unavailable')
        return { rows: [] }
      }),
    } as unknown as Pool
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const service = new RoomService({
      pool,
      valkey: {} as Redis,
      valkeyPrefix: 'test:',
      clock,
      revokeConnections: () => undefined,
    })

    const ready = service.ready()
    await flushMicrotasks()
    available = true
    await vi.advanceTimersByTimeAsync(1_000)
    await ready

    expect(pool.query).toHaveBeenCalledTimes(4)
    expect(report).toHaveBeenCalledOnce()
  })

  test('retries room scheduling without rejecting the committed operation', async () => {
    const clock = new TestClock(1_000)
    const failure = new Error('schedule query failed')
    const pool = {
      query: vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'room-1',
              createdAt: new Date(clock.now()),
              emptyAt: null,
              endedAt: null,
            },
          ],
        }),
    } as unknown as Pool
    const onError = vi.fn()
    const lifecycle = new RoomLifecycle({ pool, clock, onError })

    await expect(lifecycle.scheduleRoom('room-1')).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith(failure)

    clock.advanceTo(clock.now() + 1_000)
    await lifecycle.drain()
    expect(pool.query).toHaveBeenCalledTimes(2)
  })
})
