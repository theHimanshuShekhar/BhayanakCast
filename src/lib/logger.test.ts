import { afterEach, describe, expect, test, vi } from 'vitest'
import { logEvent, redactLogFields } from './logger'

const originalLogLevel = process.env.LOG_LEVEL

afterEach(() => {
  if (originalLogLevel === undefined) {
    delete process.env.LOG_LEVEL
  } else {
    process.env.LOG_LEVEL = originalLogLevel
  }
  vi.restoreAllMocks()
})

describe('redactLogFields', () => {
  test('redacts secrets and message content', () => {
    expect(
      redactLogFields({
        event: 'chat:send',
        DATABASE_URL: 'postgres://secret',
        VALKEY_URL: 'redis://secret',
        token: 'oauth-token',
        body: 'private chat',
        roomId: 'room-1',
      }),
    ).toEqual({
      event: 'chat:send',
      DATABASE_URL: '[redacted]',
      VALKEY_URL: '[redacted]',
      token: '[redacted]',
      body: '[redacted]',
      roomId: 'room-1',
    })
  })

  test('suppresses structured logs when LOG_LEVEL is silent', () => {
    process.env.LOG_LEVEL = 'silent'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    logEvent('room:create', { roomId: 'room-1' })

    expect(log).not.toHaveBeenCalled()
  })
})
