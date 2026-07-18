import { randomUUID } from 'node:crypto'
import { afterEach, expect, test } from 'vitest'
import { Pool } from 'pg'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { createPreferenceService } from '../../src/server/profile/preference-service'
import { getIntegrationContext } from '../setup/integration'

const pools: Pool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()))
})

test('persists one nullable theme override per account and isolates accounts', async () => {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `theme-preference-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  pools.push(pool)
  await migrateAuthDatabase(pool, context.environment.schema)

  const accountA = randomUUID()
  const accountB = randomUUID()
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Theme A', $2, false, now(), now()),
            ($3, 'Theme B', $4, false, now(), now())`,
    [accountA, `${accountA}@example.test`, accountB, `${accountB}@example.test`],
  )

  const service = createPreferenceService(pool)
  expect(await service.readTheme(accountA)).toBeNull()
  expect(await service.setTheme(accountA, 'dark')).toBe('dark')
  expect(await service.readTheme(accountA)).toBe('dark')
  expect(await service.readTheme(accountB)).toBeNull()

  await service.setTheme(accountA, null)
  expect(await service.readTheme(accountA)).toBeNull()
  expect(
    await pool.query('SELECT count(*)::int AS count FROM account_preference'),
  ).toMatchObject({ rows: [{ count: 1 }] })
  await expect(service.setTheme(accountA, 'sepia')).rejects.toThrow(TypeError)
})
