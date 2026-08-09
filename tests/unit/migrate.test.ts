import { describe, expect, test } from 'vitest'
import { resolveMigrationsFolder } from '../../src/server/db/migrate'

describe('migration folder resolution', () => {
  test('uses the runtime bundle directory in production', () => {
    expect(resolveMigrationsFolder('production', '/app')).toBe(
      '/app/dist/server/migrations',
    )
  })

  test('uses source migrations outside production', () => {
    expect(resolveMigrationsFolder('test', '/workspace')).toBe(
      '/workspace/src/server/db/migrations',
    )
  })
})
