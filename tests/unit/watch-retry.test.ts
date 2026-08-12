import fc from 'fast-check'
import { AsyncRetryer } from '@tanstack/pacer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginWatchSelection,
  WATCH_MAX_ATTEMPTS,
  WATCH_RETRY_OPTIONS,
  isDesktopCaptureClient,
  probeDirectMediaCompatibility,
  type WatchState,
} from '../../src/features/room/useRoomMedia'

describe('one-watch selection invariant', () => {
  it('replaces every prior state with exactly the newly selected Stream', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 30 }),
        (selections) => {
          let current: WatchState = { kind: 'idle' }
          for (const streamId of selections) {
            const transition = beginWatchSelection(current, streamId)
            expect(transition.previousStreamId).toBe(
              current.kind === 'idle' ? null : current.streamId,
            )
            expect(transition.next).toEqual({
              kind: 'connecting',
              streamId,
              attempt: 1,
            })
            current = transition.next
          }
          if (current.kind === 'idle') throw new Error('Expected at least one selection')
          expect(current.streamId).toBe(selections.at(-1))
        },
      ),
    )
  })
})

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

  it('aborts an in-flight peer attempt through its abort signal', async () => {
    let completed = false
    let cancelled = false
    const retryer = new AsyncRetryer(async (_streamId: string) => {
      const signal = retryer.getAbortSignal()
      if (!signal) throw new Error('Expected an active abort signal')
      await new Promise<void>((resolve, reject) => {
        const completion = setTimeout(() => {
          completed = true
          resolve()
        }, 1_000)
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(completion)
            cancelled = true
            reject(new DOMException('Peer attempt cancelled', 'AbortError'))
          },
          { once: true },
        )
      })
    }, WATCH_RETRY_OPTIONS)

    const run = retryer.execute('stream-1')
    retryer.abort()
    await vi.advanceTimersByTimeAsync(1_000)
    await run

    expect(cancelled).toBe(true)
    expect(completed).toBe(false)
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

describe('direct-media compatibility', () => {
  it('closes a successful probe peer and can be run again after a failure', async () => {
    const failedClose = vi.fn()
    const passedClose = vi.fn()
    const failed = {
      addTransceiver: vi.fn(),
      createOffer: vi.fn().mockRejectedValue(new Error('unsupported')),
      setLocalDescription: vi.fn(),
      close: failedClose,
    } as unknown as RTCPeerConnection
    const passed = {
      addTransceiver: vi.fn(),
      createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'probe' }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      close: passedClose,
    } as unknown as RTCPeerConnection

    await expect(probeDirectMediaCompatibility(() => failed)).resolves.toBe(false)
    await expect(probeDirectMediaCompatibility(() => passed)).resolves.toBe(true)
    expect(failedClose).toHaveBeenCalledOnce()
    expect(passedClose).toHaveBeenCalledOnce()
  })

  it('keeps capture desktop-only without disabling compatible mobile watching', () => {
    const mediaDevices = { getDisplayMedia: vi.fn() }
    expect(
      isDesktopCaptureClient({
        mediaDevices,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/136.0.0.0 Safari/537.36',
      }),
    ).toBe(true)
    expect(
      isDesktopCaptureClient({
        mediaDevices,
        userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/136.0.0.0 Mobile',
      }),
    ).toBe(false)
    expect(
      isDesktopCaptureClient({
        mediaDevices,
        userAgent: 'Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15',
      }),
    ).toBe(false)
  })
})
