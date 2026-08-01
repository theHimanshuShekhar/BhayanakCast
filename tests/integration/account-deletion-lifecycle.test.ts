import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, test } from 'vitest'
import { Pool } from 'pg'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { accountAccessPolicy } from '../../src/server/auth/account-access-policy'
import { HomeRepository, createPoolHomeQueryExecutor } from '../../src/server/home/home-repository'
import {
  applyEnforcementSanctions,
  createEnforcementKey,
} from '../../src/server/moderation/sanction-enforcement'
import { createDeletionService } from '../../src/server/profile/deletion-service'
import { runRetention } from '../../src/server/retention/retention-service'
import { getIntegrationContext } from '../setup/integration'

const pools: Pool[] = []
const secret = 'account-deletion-enforcement-secret-0001'

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()))
})

async function fixture(discordId = '102938475610293847') {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    options: `-c search_path=${context.environment.schema}`,
  })
  pools.push(pool)
  await migrateAuthDatabase(pool, context.environment.schema)
  const accountId = randomUUID()
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, image, created_at, updated_at)
     VALUES ($1, 'Lifecycle member', $2, true, 'https://cdn.example/avatar', now(), now())`,
    [accountId, `${accountId}@example.test`],
  )
  await pool.query(
    `INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at)
     VALUES ($1, $2, 'discord', $3, now(), now())`,
    [randomUUID(), discordId, accountId],
  )
  return { pool, accountId }
}

describe('complete Account deletion lifecycle', () => {
  test('approval anonymizes every projection, revokes access, and enforces active sanctions on a fresh Account', async () => {
    const { pool, accountId } = await fixture()
    const roomId = randomUUID()
    const membershipId = randomUUID()
    const reportId = randomUUID()
    await pool.query(
      `INSERT INTO room (id, name, tags, visibility, created_by, created_at, ended_at)
       VALUES ($1, 'Surviving room', ARRAY[]::text[], 'public', $2, now() - interval '2 hours', now() - interval '1 hour')`,
      [roomId, accountId],
    )
    await pool.query(
      `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
       VALUES ($1, $2, $3, 'host', now() - interval '2 hours', now() - interval '1 hour')`,
      [membershipId, roomId, accountId],
    )
    await pool.query(
      `INSERT INTO message (id, room_id, membership_id, body, created_at)
       VALUES ($1, $2, $3, 'private chat content', now() - interval '90 minutes')`,
      [randomUUID(), roomId, membershipId],
    )
    await pool.query(
      `INSERT INTO platform_sanction (id, account_id, type, starts_at, expires_at)
       VALUES ($1, $2, 'chat', now() - interval '1 day', now() + interval '7 days')`,
      [randomUUID(), accountId],
    )
    await pool.query(
      `INSERT INTO report
         (id, reporter_account_id, target_type, target_id, reason, created_at)
       VALUES ($1, $2, 'account', $2, 'harassment', now())`,
      [reportId, accountId],
    )
    await pool.query(
      `INSERT INTO session (id, expires_at, token, user_id, created_at, updated_at)
       VALUES ($1, now() + interval '1 day', $2, $3, now(), now())`,
      [randomUUID(), randomUUID(), accountId],
    )

    const forgottenDiscordIds: string[] = []
    const service = createDeletionService(pool, {
      enforcementKey: (discordId) => createEnforcementKey(secret, discordId),
      analytics: {
        record: () => undefined,
        forget: async (discordId) => {
          forgottenDiscordIds.push(discordId)
        },
      },
    })
    await service.submit(accountId)
    expect(accountAccessPolicy({ deletionStatus: 'pending' }).canMutate('report')).toBe(false)
    await expect(
      new HomeRepository(createPoolHomeQueryExecutor(pool)).publicProfile(accountId),
    ).resolves.toBeNull()

    await expect(service.respond(accountId, 'approved')).resolves.toMatchObject({ status: 'approved' })
    expect(forgottenDiscordIds).toEqual(['102938475610293847'])
    await expect(pool.query('SELECT 1 FROM session WHERE user_id = $1', [accountId])).resolves.toMatchObject({ rows: [] })
    await expect(pool.query('SELECT 1 FROM account WHERE user_id = $1', [accountId])).resolves.toMatchObject({ rows: [] })
    await expect(pool.query('SELECT name, image FROM "user" WHERE id = $1', [accountId])).resolves.toMatchObject({ rows: [{ name: 'Deleted account', image: null }] })
    await expect(pool.query('SELECT body FROM message WHERE membership_id = $1', [membershipId])).resolves.toMatchObject({ rows: [{ body: '[redacted: account deleted]' }] })
    await expect(pool.query('SELECT created_by FROM room WHERE id = $1', [roomId])).resolves.toMatchObject({ rows: [{ created_by: null }] })
    await expect(pool.query('SELECT reporter_account_id, reporter_subject_ref, target_id, subject_ref FROM report WHERE id = $1', [reportId])).resolves.toMatchObject({ rows: [{ reporter_account_id: null, reporter_subject_ref: expect.any(String), target_id: 'anonymized', subject_ref: expect.any(String) }] })

    const freshAccountId = randomUUID()
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ($1, 'Fresh member', $2, true, now(), now())`,
      [freshAccountId, `${freshAccountId}@example.test`],
    )
    await expect(
      applyEnforcementSanctions(pool, freshAccountId, '102938475610293847', secret),
    ).resolves.toEqual(['chat'])
    await expect(pool.query('SELECT type FROM platform_sanction WHERE account_id = $1', [freshAccountId])).resolves.toMatchObject({ rows: [{ type: 'chat' }] })
    await expect(new HomeRepository(createPoolHomeQueryExecutor(pool)).publicProfile(freshAccountId)).resolves.toMatchObject({ roomCount: 0, streamCount: 0 })
  })

  test('keeps approval pending until PostHog removes the Discord identity', async () => {
    const { pool, accountId } = await fixture('102938475610293848')
    const service = createDeletionService(pool, {
      enforcementKey: (discordId) => createEnforcementKey(secret, discordId),
      analytics: {
        record: () => undefined,
        forget: () => Promise.reject(new Error('PostHog unavailable')),
      },
    })
    await service.submit(accountId)

    await expect(service.respond(accountId, 'approved')).rejects.toThrow('PostHog unavailable')
    await expect(service.current(accountId)).resolves.toMatchObject({ status: 'pending' })
    await expect(
      pool.query('SELECT account_id FROM account WHERE user_id = $1', [accountId]),
    ).resolves.toMatchObject({ rows: [{ account_id: '102938475610293848' }] })
    await pool.query('DELETE FROM deletion_request WHERE account_id = $1', [accountId])
    await pool.query('DELETE FROM account WHERE user_id = $1', [accountId])
    await pool.query('DELETE FROM "user" WHERE id = $1', [accountId])
  })

  test('retention preserves both sides of each exact boundary and audits only counts', async () => {
    const { pool, accountId } = await fixture()
    const adminId = randomUUID()
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ($1, 'Admin', $2, true, now(), now())`,
      [adminId, `${adminId}@example.test`],
    )
    const ranAt = new Date('2027-08-01T00:00:00.000Z')
    await pool.query(
      `DELETE FROM message persisted
        USING room ended
        WHERE persisted.room_id = ended.id
          AND ended.ended_at IS NOT NULL
          AND ended.ended_at <= $1::timestamp - interval '30 days'`,
      [ranAt],
    )
    await pool.query(
      `DELETE FROM report
        WHERE status IN ('resolved', 'dismissed')
          AND retain_until <= $1::timestamp`,
      [ranAt],
    )
    await pool.query('DELETE FROM retention_run_audit WHERE ran_at = $1', [ranAt])
    for (const age of ['29 days 23 hours 59 minutes 59 seconds', '30 days']) {
      const roomId = randomUUID()
      const membershipId = randomUUID()
      await pool.query(
        `INSERT INTO room (id, name, tags, visibility, created_at, ended_at)
         VALUES ($1, 'Retention room', ARRAY[]::text[], 'public', $2::timestamp - $3::interval - interval '1 hour', $2::timestamp - $3::interval)`,
        [roomId, ranAt, age],
      )
      await pool.query(
        `INSERT INTO room_membership (id, room_id, account_id, joined_at, left_at)
         VALUES ($1, $2, $3, $4::timestamp - $5::interval - interval '1 hour', $4::timestamp - $5::interval)`,
        [membershipId, roomId, accountId, ranAt, age],
      )
      await pool.query(
        `INSERT INTO message (id, room_id, membership_id, body, created_at)
         VALUES ($1, $2, $3, 'retained transcript', $4::timestamp - $5::interval)`,
        [randomUUID(), roomId, membershipId, ranAt, age],
      )
    }
    const expiredReportId = randomUUID()
    const pendingReportId = randomUUID()
    await pool.query(
      `INSERT INTO report
         (id, reporter_account_id, target_type, target_id, reason, created_at, status,
          resolved_by_account_id, resolved_at, retain_until, evidence_content,
          evidence_content_type, evidence_captured_at)
       VALUES
         ($1, $3, 'stream', $4, 'privacy', $2::timestamp - interval '1 year', 'resolved',
          $3, $2::timestamp - interval '1 year', $2, decode('00', 'hex'), 'image/webp', $2::timestamp - interval '1 year'),
         ($5, $3, 'account', $3, 'spam', $2::timestamp - interval '2 years', 'pending',
          NULL, NULL, NULL, NULL, NULL, NULL)`,
      [expiredReportId, ranAt, adminId, randomUUID(), pendingReportId],
    )

    await expect(runRetention(pool, ranAt)).resolves.toMatchObject({
      transcriptRowsDeleted: 1,
      reportRowsDeleted: 1,
    })
    await expect(
      pool.query(`SELECT body FROM message WHERE body = 'retained transcript'`),
    ).resolves.toMatchObject({ rows: [{ body: 'retained transcript' }] })
    await expect(
      pool.query('SELECT id FROM report WHERE id = ANY($1::uuid[])', [
        [expiredReportId, pendingReportId],
      ]),
    ).resolves.toMatchObject({ rows: [{ id: pendingReportId }] })
    await expect(
      pool.query(
        `SELECT transcript_rows_deleted, report_rows_deleted
           FROM retention_run_audit
          WHERE ran_at = $1`,
        [ranAt],
      ),
    ).resolves.toMatchObject({
      rows: [{ transcript_rows_deleted: 1, report_rows_deleted: 1 }],
    })
  })
})
