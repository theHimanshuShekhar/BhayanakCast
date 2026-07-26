import { randomUUID } from 'node:crypto'
import { afterEach, expect, test } from 'vitest'
import { Pool } from 'pg'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import {
  createChatMuteService,
  isChatPresentationAllowed,
} from '../../src/server/profile/chat-mute-service'
import { getIntegrationContext } from '../setup/integration'

const pools: Pool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()))
})

async function setupDatabase(testName: string) {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `${testName}-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  pools.push(pool)
  await migrateAuthDatabase(pool, context.environment.schema)
  return pool
}

async function insertUser(pool: Pool, id: string, name: string, image?: string) {
  await pool.query(
    `INSERT INTO "user" (id, name, email, image, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, now(), now())`,
    [id, name, `${id}@example.test`, image ?? null],
  )
}

test('mutes are idempotent, reject self-mutes, and do not touch room state', async () => {
  const pool = await setupDatabase('chat-mutes-contract')
  const viewerId = randomUUID()
  const targetId = randomUUID()
  await insertUser(pool, viewerId, 'Viewer')
  await insertUser(pool, targetId, 'Target')

  const service = createChatMuteService(pool)
  await service.mute(viewerId, targetId)
  await service.mute(viewerId, targetId)

  await expect(service.mute(viewerId, viewerId)).rejects.toThrow('cannot mute yourself')
  expect(
    await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM chat_mute WHERE muting_account_id = $1 AND muted_account_id = $2',
      [viewerId, targetId],
    ),
  ).toMatchObject({ rows: [{ count: 1 }] })
  expect(
    await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM room_membership'),
  ).toMatchObject({ rows: [{ count: 0 }] })
  expect(
    await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM stream'),
  ).toMatchObject({ rows: [{ count: 0 }] })
})

test('mute lists are viewer-isolated and project only current mirrored identities', async () => {
  const pool = await setupDatabase('chat-mutes-privacy')
  const viewerId = randomUUID()
  const targetId = randomUUID()
  const otherViewerId = randomUUID()
  await insertUser(pool, viewerId, 'Viewer')
  await insertUser(pool, targetId, 'Target', 'target-avatar')
  await insertUser(pool, otherViewerId, 'Other viewer')

  const service = createChatMuteService(pool)
  await service.mute(viewerId, targetId)
  await service.mute(otherViewerId, viewerId)

  expect(await service.list(viewerId)).toEqual([
    { accountId: targetId, displayName: 'Target', avatarUrl: 'target-avatar' },
  ])
  expect(await service.list(otherViewerId)).toEqual([
    { accountId: viewerId, displayName: 'Viewer', avatarUrl: null },
  ])
  expect(await service.list(targetId)).toEqual([])

  await pool.query(
    'INSERT INTO account_state (account_id, deletion_requested_at) VALUES ($1, now())',
    [targetId],
  )
  expect(await service.list(viewerId)).toEqual([])
})

test('unmute immediately restores the chat projection and exposes one viewer mute-id set', async () => {
  const pool = await setupDatabase('chat-mutes-projection')
  const viewerId = randomUUID()
  const targetId = randomUUID()
  const otherId = randomUUID()
  await insertUser(pool, viewerId, 'Viewer')
  await insertUser(pool, targetId, 'Target')
  await insertUser(pool, otherId, 'Other')

  const service = createChatMuteService(pool)
  await service.mute(viewerId, targetId)
  await service.mute(viewerId, otherId)

  const mutedIds = await service.getMuteIds(viewerId)
  expect(mutedIds).toEqual(new Set([targetId, otherId]))
  expect(isChatPresentationAllowed(viewerId, targetId, mutedIds)).toBe(false)
  expect(isChatPresentationAllowed(viewerId, viewerId, mutedIds)).toBe(true)
  expect(isChatPresentationAllowed(viewerId, randomUUID(), mutedIds)).toBe(true)

  await service.unmute(viewerId, targetId)
  const afterUnmute = await service.getMuteIds(viewerId)
  expect(afterUnmute).toEqual(new Set([otherId]))
  expect(isChatPresentationAllowed(viewerId, targetId, afterUnmute)).toBe(true)
})
