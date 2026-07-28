import { AsyncRetryer } from '@tanstack/pacer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WATCH_MAX_ATTEMPTS, WATCH_RETRY_OPTIONS } from '../../src/features/room/useRoomMedia'

/** ADR 0077: after the first direct-watch attempt fails, the same Stream is
    retried three times at 1, 2 and 4 seconds — and never again without a fresh
    explicit selection or manual Retry. */
describe('direct-watch retry policy', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function failingRetryer() {
    const waits: number[] = []
    let attempts = 0
    let exhausted = false
    const retryer = new AsyncRetryer(
      async (_streamId: string) => {
        attempts += 1
        throw new Error('peer-failed')
      },
      {
        ...WATCH_RETRY_OPTIONS,
        onRetry: () => waits.push(Date.now()),
        onLastError: () => {
          exhausted = true
        },
      },
    )
    return { retryer, waits, count: () => attempts, wasExhausted: () => exhausted }
  }

  it('makes four attempts spaced one, two and four seconds apart', async () => {
    const subject = failingRetryer()
    const started = Date.now()
    const run = subject.retryer.execute('stream-1')

    await vi.advanceTimersByTimeAsync(0)
    expect(subject.count()).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(subject.count()).toBe(2)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(subject.count()).toBe(3)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(subject.count()).toBe(WATCH_MAX_ATTEMPTS)

    await run
    expect(subject.waits.map((at) => at - started)).toEqual([0, 1_000, 3_000])
    expect(subject.wasExhausted()).toBe(true)
  })

  it('stops on exhaustion rather than continuing on its own', async () => {
    const subject = failingRetryer()
    const run = subject.retryer.execute('stream-1')
    await vi.advanceTimersByTimeAsync(7_000)
    await run
    await vi.advanceTimersByTimeAsync(60_000)
    expect(subject.count()).toBe(WATCH_MAX_ATTEMPTS)
  })

  it('aborts the in-flight attempt and its pending retry', async () => {
    const subject = failingRetryer()
    const run = subject.retryer.execute('stream-1')
    await vi.advanceTimersByTimeAsync(0)
    subject.retryer.abort()
    await vi.advanceTimersByTimeAsync(60_000)
    await run
    expect(subject.count()).toBe(1)
    expect(subject.wasExhausted()).toBe(false)
  })

  it('exposes an abort signal so a peer attempt can be cancelled', async () => {
    const retryer = new AsyncRetryer(async (_streamId: string) => {}, WATCH_RETRY_OPTIONS)
    let observed: AbortSignal | null = null
    retryer.fn = async (_streamId: string) => {
      observed = retryer.getAbortSignal()
    }
    await retryer.execute('stream-1')
    expect(observed).toBeInstanceOf(AbortSignal)
  })

  it('never adds jitter to the documented waits', () => {
    expect(WATCH_RETRY_OPTIONS).toMatchObject({
      maxAttempts: 4,
      backoff: 'exponential',
      baseWait: 1_000,
      maxWait: 4_000,
      jitter: 0,
    })
  })
})
