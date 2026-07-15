import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchSessionProjection } from '../../src/features/auth/auth-client'
import { safeOAuthCallbackPath } from '../../src/features/auth/SignInButton'

describe('Discord OAuth callback path', () => {
  test('keeps only a same-origin path and never carries private query data', () => {
    expect(safeOAuthCallbackPath('/rooms/room_123?password=private#join')).toBe(
      '/rooms/room_123',
    )
    expect(safeOAuthCallbackPath('//attacker.example/rooms/room_123')).toBe('/')
    expect(safeOAuthCallbackPath('https://attacker.example/rooms/room_123')).toBe(
      '/',
    )
  })
})

describe('session projection client', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('parses the server expiry without accepting extra account fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          id: 'account_123',
          displayName: 'Member',
          avatar: null,
          isPlatformAdmin: false,
          expiresAt: '2030-01-08T00:00:00.000Z',
          email: 'must-not-leak@example.test',
          token: 'must-not-leak',
        }),
      ),
    )

    await expect(fetchSessionProjection()).resolves.toEqual({
      id: 'account_123',
      displayName: 'Member',
      avatar: null,
      isPlatformAdmin: false,
      expiresAt: new Date('2030-01-08T00:00:00.000Z'),
    })
  })

  test('represents anonymous access as null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(null)))
    await expect(fetchSessionProjection()).resolves.toBeNull()
  })

  test('rejects a failed session response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    await expect(fetchSessionProjection()).rejects.toThrow(
      'Unable to read session (503)',
    )
  })
})
