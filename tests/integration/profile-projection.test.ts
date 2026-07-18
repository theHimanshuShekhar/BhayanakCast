import { randomUUID } from 'node:crypto'
import { afterEach, expect, test } from 'vitest'
import { Pool } from 'pg'
import {
  createPoolHomeQueryExecutor,
  HomeRepository,
} from '../../src/server/home/home-repository'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { getIntegrationContext } from '../setup/integration'

const pools: Pool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()))
})

test('current Profile reuses the bounded public projection without private account fields', async () => {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `profile-projection-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  pools.push(pool)
  await migrateAuthDatabase(pool, context.environment.schema)

  const accountId = randomUUID()
  await pool.query(
    `INSERT INTO "user" (id, name, email, image, email_verified, created_at, updated_at)
     VALUES ($1, 'Profile member', 'private@example.test', 'profile-avatar', false, now(), now())`,
    [accountId],
  )

  const profile = await new HomeRepository(
    createPoolHomeQueryExecutor(pool),
  ).publicProfile(accountId)

  expect(profile).toEqual({
    accountId,
    displayName: 'Profile member',
    avatarUrl: 'profile-avatar',
    roomCount: 0,
    streamCount: 0,
    pastStreams: [],
    coUsers: [],
  })
  expect(profile).not.toHaveProperty('email')
  expect(profile).not.toHaveProperty('preferences')
  expect(profile).not.toHaveProperty('deletionRequestedAt')
})
