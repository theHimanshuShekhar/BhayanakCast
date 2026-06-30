import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { readServerEnv } from './env'

describe('readServerEnv', () => {
  test('parses required server environment', () => {
    const env = readServerEnv({
      PORT: '4321',
      DATABASE_URL: 'postgres://app:app@postgres:5432/bhayanakcast',
      VALKEY_URL: 'redis://valkey:6379',
      BETTER_AUTH_URL: 'https://example.test',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      DISCORD_CLIENT_ID: 'discord-client',
      DISCORD_CLIENT_SECRET: 'discord-secret',
      ADMIN_DISCORD_IDS: '111, 222',
      LOG_LEVEL: 'debug',
      CLOUDFLARED_PUBLIC_URL: 'https://bhayanakcast.example',
    })

    expect(env.PORT).toBe(4321)
    expect(env.LOG_LEVEL).toBe('debug')
    expect(env.CLOUDFLARED_PUBLIC_URL).toBe('https://bhayanakcast.example')
    expect(env.ADMIN_DISCORD_IDS).toEqual(['111', '222'])
  })

  test('rejects missing secrets', () => {
    expect(() =>
      readServerEnv({
        PORT: '3000',
        DATABASE_URL: 'postgres://app:app@postgres:5432/bhayanakcast',
      }),
    ).toThrow(/BETTER_AUTH_SECRET/)
  })
})

describe('docker compose service exposure', () => {
  test('publishes only the app port by default', () => {
    const compose = readFileSync(
      new URL('../../docker-compose.yml', import.meta.url),
      'utf8',
    )

    expect(compose).toContain('${PORT:-3000}:3000')
    expect(compose).not.toContain('5432:5432')
    expect(compose).not.toContain('6379:6379')
  })
})
