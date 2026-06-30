import { describe, expect, test } from 'vitest'
import { buildAuthConfig } from './auth-config'

describe('buildAuthConfig', () => {
  test('uses Discord as the only v1 sign-in provider', () => {
    const config = buildAuthConfig({
      BETTER_AUTH_URL: 'https://example.test',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      DISCORD_CLIENT_ID: 'discord-client',
      DISCORD_CLIENT_SECRET: 'discord-secret',
    })

    expect('emailAndPassword' in config).toBe(false)
    expect(config.socialProviders.discord).toEqual({
      clientId: 'discord-client',
      clientSecret: 'discord-secret',
    })
    expect(config.baseURL).toBe('https://example.test')
  })
})
