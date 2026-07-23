import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createElement: vi.fn((component: unknown, props: unknown) => ({ component, props })),
  effect: undefined as (() => (() => void) | void) | undefined,
  handlers: new Map<string, (...args: never[]) => void>(),
  invalidateQueries: vi.fn(),
  ioSocket: undefined as {
    connected: boolean
    io: { opts: { reconnection: boolean } }
    on: (event: string, handler: (...args: never[]) => void) => void
    off: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
  } | undefined,
  refIndex: 0,
  refs: [] as Array<{ current: unknown }>,
  state: 'idle' as 'idle' | 'reconnecting' | 'error' | 'replaced' | 'revoked',
  setState: vi.fn((next: 'idle' | 'reconnecting' | 'error' | 'replaced' | 'revoked') => {
    mocks.state = next
  }),
}))

vi.mock('react', () => ({
  createElement: mocks.createElement,
  useEffect: (effect: () => (() => void) | void) => {
    mocks.effect = effect
  },
  useRef: (initial: unknown) => {
    const index = mocks.refIndex++
    mocks.refs[index] ??= { current: initial }
    return mocks.refs[index]
  },
  useState: () => [mocks.state, mocks.setState],
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const socket = {
      connected: true,
      io: { opts: { reconnection: true } },
      on: (event: string, handler: (...args: never[]) => void) => {
        mocks.handlers.set(event, handler)
      },
      off: vi.fn(),
      disconnect: vi.fn(() => {
        socket.connected = false
      }),
      connect: vi.fn(() => {
        socket.connected = true
      }),
    }
    mocks.ioSocket = socket
    return socket
  }),
}))

import { HomeRealtimeBridge } from '../../src/features/home/home-realtime'

function renderBridge(onCanonicalRefresh: () => void) {
  mocks.refIndex = 0
  return HomeRealtimeBridge({ enabled: true, onCanonicalRefresh }) as unknown as {
    props: { onRetry?: () => void }
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Home realtime canonical refresh callback', () => {
  beforeEach(() => {
    mocks.createElement.mockClear()
    mocks.effect = undefined
    mocks.handlers.clear()
    mocks.invalidateQueries.mockReset()
    mocks.ioSocket = undefined
    mocks.refIndex = 0
    mocks.refs = []
    mocks.state = 'idle'
    mocks.setState.mockClear()
  })

  test('does not recompute rank after failure, retries once, and ignores duplicates after cleanup', async () => {
    const failure = new Error('canonical refresh failed')
    let canonicalAttempt = 0
    mocks.invalidateQueries.mockImplementation((filters: { refetchType?: string }) => {
      if (filters.refetchType === 'none') return Promise.resolve()
      canonicalAttempt += 1
      return canonicalAttempt === 1 ? Promise.reject(failure) : Promise.resolve()
    })
    const onCanonicalRefresh = vi.fn()
    const rendered = renderBridge(onCanonicalRefresh)
    const cleanup = mocks.effect?.()
    const disconnect = mocks.handlers.get('disconnect')
    const connect = mocks.handlers.get('connect')
    if (!disconnect || !connect || !cleanup || !mocks.ioSocket) throw new Error('bridge did not mount')

    disconnect()
    connect()
    await flushMicrotasks()
    expect(onCanonicalRefresh).toHaveBeenCalledTimes(0)

    const retry = renderBridge(onCanonicalRefresh).props.onRetry
    expect(retry).toBeTypeOf('function')
    retry?.()
    await flushMicrotasks()
    expect(onCanonicalRefresh).toHaveBeenCalledTimes(1)

    retry?.()
    cleanup()
    retry?.()
    expect(onCanonicalRefresh).toHaveBeenCalledTimes(1)
  })
  test('surfaces refresh failure when the transport drops during the refresh', async () => {
    const failure = new Error('canonical refresh failed')
    mocks.invalidateQueries.mockImplementation((filters: { refetchType?: string }) =>
      filters.refetchType === 'none' ? Promise.resolve() : Promise.reject(failure),
    )
    renderBridge(vi.fn())
    const cleanup = mocks.effect?.()
    const disconnect = mocks.handlers.get('disconnect')
    const connect = mocks.handlers.get('connect')
    if (!disconnect || !connect || !cleanup || !mocks.ioSocket) throw new Error('bridge did not mount')

    disconnect()
    connect()
    mocks.ioSocket.connected = false
    await flushMicrotasks()

    expect(mocks.state).toBe('error')
    cleanup()
  })

})
