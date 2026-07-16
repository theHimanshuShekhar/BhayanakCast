import { describe, expect, test } from 'vitest'
import {
  discordPlaceholderEmail,
  mapDiscordProfile,
} from '../../src/server/auth/discord-profile'
import {
  parseAdminDiscordIds,
  projectSession,
  resolveTrustedClientIp,
} from '../../src/server/auth/session'

const DISCORD_ID = '102938475610293847'

describe('Discord profile boundary', () => {
  test('maps the stable Discord id with the current display name, avatar, and verified email', () => {
    expect(
      mapDiscordProfile({
        id: DISCORD_ID,
        username: 'stale-username',
        global_name: 'Current display name',
        avatar: 'avatar-hash',
        email: 'member@example.test',
        verified: true,
      }),
    ).toEqual({
      id: DISCORD_ID,
      name: 'Current display name',
      image: `https://cdn.discordapp.com/avatars/${DISCORD_ID}/avatar-hash.png`,
      email: 'member@example.test',
      emailVerified: true,
    })
  })

  test('maps an email-less Discord identity to an unverified non-routable placeholder', () => {
    const profile = mapDiscordProfile({
      id: DISCORD_ID,
      username: 'member',
      global_name: 'Member',
      avatar: 'avatar-hash',
      verified: false,
    })

    expect(discordPlaceholderEmail(DISCORD_ID)).toBe(
      `${DISCORD_ID}@discord.placeholder.local`,
    )
    expect(profile).toMatchObject({
      id: DISCORD_ID,
      email: `${DISCORD_ID}@discord.placeholder.local`,
      emailVerified: false,
    })
  })

  test('never projects a placeholder email or sensitive session metadata', () => {
    const expiresAt = new Date('2030-01-08T00:00:00.000Z')

    expect(
      projectSession({
        user: {
          id: 'user_opaque_123',
          name: 'Member',
          image: 'https://cdn.discordapp.com/avatars/102938475610293847/avatar-hash.png',
          email: discordPlaceholderEmail(DISCORD_ID),
          emailVerified: false,
        },
        session: {
          expiresAt,
          token: 'secret-session-token',
          ipAddress: '203.0.113.41',
          userAgent: 'private user agent',
        },
        isPlatformAdmin: false,
      }),
    ).toEqual({
      id: 'user_opaque_123',
      displayName: 'Member',
      avatar: 'https://cdn.discordapp.com/avatars/102938475610293847/avatar-hash.png',
      isPlatformAdmin: false,
      expiresAt,
    })
  })

  test('rejects malformed admin allowlists and exposes authorization only as a boolean predicate', () => {
    expect(() => parseAdminDiscordIds('not-a-discord-id')).toThrow()
    expect(() => parseAdminDiscordIds(`${DISCORD_ID}, 1234`)).toThrow()

    const isPlatformAdmin = parseAdminDiscordIds(
      `${DISCORD_ID}, 918273645091827364`,
    )

    expect(typeof isPlatformAdmin).toBe('function')
    expect(isPlatformAdmin(DISCORD_ID)).toBe(true)
    expect(isPlatformAdmin('918273645091827364')).toBe(true)
    expect(isPlatformAdmin('111111111111111111')).toBe(false)
  })

  test('accepts forwarded client IP headers only from an explicitly trusted proxy', () => {
    const spoofedHeaders = new Headers({
      'cf-connecting-ip': '203.0.113.77',
      'x-forwarded-for': '203.0.113.77, 198.51.100.10',
    })
    expect(
      resolveTrustedClientIp(
        { directIp: '198.51.100.10', headers: spoofedHeaders },
        { trustedProxyIps: ['127.0.0.1'] },
      ),
    ).toBe('198.51.100.10')

    expect(
      resolveTrustedClientIp(
        {
          directIp: '127.0.0.1',
          headers: new Headers({
            'cf-connecting-ip': '203.0.113.77',
          }),
        },
        { trustedProxyIps: ['127.0.0.1'] },
      ),
    ).toBe('203.0.113.77')
  })
})
