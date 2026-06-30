import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  checkRateLimit,
  enforceRateLimit,
  createMemoryRateLimitStore,
  rateLimitRules,
} from './rate-limit'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
describe('rate limits', () => {
  test('documents default abuse-control limits', () => {
    expect(rateLimitRules).toMatchObject({
      roomCreate: { limit: 5, windowMs: 60 * 60 * 1000 },
      chatMessage: { limit: 30, windowMs: 60 * 1000 },
      reportCreate: { limit: 10, windowMs: 60 * 60 * 1000 },
      streamThumbnail: { limit: 1, windowMs: 110 * 1000 },
      streamCommand: { limit: 10, windowMs: 60 * 1000 },
      privateRoomPassword: { limit: 10, windowMs: 10 * 60 * 1000 },
    })
  })

  test('rejects requests after the fixed window budget is used', async () => {
    let now = 0
    const store = createMemoryRateLimitStore(() => now)
    const rule = { limit: 2, windowMs: 1000 }

    await expect(
      checkRateLimit({ key: 'test:key', rule, store }),
    ).resolves.toMatchObject({
      allowed: true,
      count: 1,
    })
    await expect(
      checkRateLimit({ key: 'test:key', rule, store }),
    ).resolves.toMatchObject({
      allowed: true,
      count: 2,
    })
    await expect(
      checkRateLimit({ key: 'test:key', rule, store }),
    ).resolves.toMatchObject({
      allowed: false,
      count: 3,
    })

    now = 1001
    await expect(
      checkRateLimit({ key: 'test:key', rule, store }),
    ).resolves.toMatchObject({
      allowed: true,
      count: 1,
    })
  })

  test('logs rate limit rejects without raw keys', async () => {
    vi.stubEnv('LOG_LEVEL', 'info')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const store = createMemoryRateLimitStore()
    const rule = { limit: 1, windowMs: 1000 }

    await enforceRateLimit('rate:chat:user-1:room-1', rule, store)
    await expect(
      enforceRateLimit('rate:chat:user-1:room-1', rule, store),
    ).rejects.toThrow('RATE_LIMITED')

    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'rate-limit:reject',
        rateLimitKey: 'rate:chat',
        count: 2,
        limit: 1,
      }),
    )
  })
})
