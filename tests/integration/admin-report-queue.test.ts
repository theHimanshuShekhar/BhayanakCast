import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, test } from 'vitest'
import { Pool } from 'pg'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import {
  PlatformAdminAuthorizationError,
  ReportService,
  type AdminActor,
  type ReportInput,
} from '../../src/server/moderation/report-service'
import { getIntegrationContext } from '../setup/integration'

const pools: Pool[] = []
const EVIDENCE = Buffer.from('524946460000000057454250', 'hex')

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()))
})

async function fixture() {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `admin-reports-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  pools.push(pool)
  await migrateAuthDatabase(pool, context.environment.schema)
  const reporterId = randomUUID()
  const targetAccountId = randomUUID()
  const adminId = randomUUID()
  for (const [id, name] of [[reporterId, 'Reporter'], [targetAccountId, 'Target Account'], [adminId, 'Platform Admin']]) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, false, now(), now())`,
      [id, name, `${id}@example.test`],
    )
  }
  const roomId = randomUUID()
  const reporterMembershipId = randomUUID()
  const targetMembershipId = randomUUID()
  const streamId = randomUUID()
  const messageId = randomUUID()
  await pool.query(
    `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_at, ended_at)
     VALUES ($1, 'Review room', NULL, ARRAY[]::text[], 'public', NULL, now(), NULL)`,
    [roomId],
  )
  await pool.query(
    `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
     VALUES ($1, $3, $4, 'host', now(), NULL), ($2, $3, $5, 'member', now(), NULL)`,
    [reporterMembershipId, targetMembershipId, roomId, reporterId, targetAccountId],
  )
  await pool.query(
    `INSERT INTO stream (id, room_id, membership_id, preview_key, preview_updated_at, started_at, ended_at)
     VALUES ($1, $2, $3, $4, now(), now(), NULL)`,
    [streamId, roomId, targetMembershipId, randomUUID()],
  )
  await pool.query(
    `INSERT INTO message (id, room_id, membership_id, body, created_at)
     VALUES ($1, $2, $3, 'Private chat target', now())`,
    [messageId, roomId, targetMembershipId],
  )
  const logs: Readonly<Record<string, unknown>>[] = []
  const now = new Date('2026-08-01T10:00:00.000Z')
  const service = new ReportService(pool, {
    now: () => now,
    readPreview: async () => EVIDENCE,
    operationalLog: (entry) => logs.push(entry),
  })
  const admin: AdminActor = { accountId: adminId, isPlatformAdmin: true }
  return { pool, service, admin, reporterId, targetAccountId, roomId, streamId, messageId, logs, now }
}

function input(targetType: ReportInput['targetType'], targetId: string, roomId: string): ReportInput {
  return { targetType, targetId, roomId, reason: 'privacy', details: 'Structured review details' }
}

describe('Platform Admin report queue', () => {
  test('validates and privately projects Account, Room, Stream, and chat-message targets', async () => {
    const value = await fixture()
    for (const [type, id] of [
      ['account', value.targetAccountId], ['room', value.roomId],
      ['stream', value.streamId], ['message', value.messageId],
    ] as const) {
      await expect(
        value.service.submit(value.reporterId, input(type, id, value.roomId)),
      ).resolves.toEqual({ status: 'received' })
    }
    const queue = await value.service.list(value.admin)
    expect(queue).toHaveLength(4)
    const details = await Promise.all(queue.map((report) => value.service.detail(value.admin, report.id)))
    expect(details.map((report) => report?.target.type).sort()).toEqual(['account', 'message', 'room', 'stream'])
    expect(details.find((report) => report?.target.type === 'message')).toMatchObject({
      target: { type: 'message', message: { body: 'Private chat target' } },
    })
    expect(details.find((report) => report?.target.type === 'stream')).toMatchObject({
      evidenceAvailable: true,
      evidenceDataUrl: `data:image/webp;base64,${EVIDENCE.toString('base64')}`,
    })
  })

  test('rejects fabricated or cross-room targets before storage', async () => {
    const value = await fixture()
    const before = await value.pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM report',
    )
    await expect(value.service.submit(value.reporterId, input('stream', randomUUID(), value.roomId))).resolves.toEqual({ status: 'invalid-target' })
    await expect(
      value.pool.query<{ count: number }>('SELECT count(*)::integer AS count FROM report'),
    ).resolves.toMatchObject({ rows: before.rows })
  })

  test('allows only Platform Admin actors to list, inspect, or act', async () => {
    const value = await fixture()
    await value.service.submit(value.reporterId, input('account', value.targetAccountId, value.roomId))
    const reportId = (await value.service.list(value.admin))[0]!.id
    const ordinary = { accountId: value.reporterId, isPlatformAdmin: false }
    await expect(value.service.list(ordinary)).rejects.toBeInstanceOf(PlatformAdminAuthorizationError)
    await expect(value.service.detail(ordinary, reportId)).rejects.toBeInstanceOf(PlatformAdminAuthorizationError)
    await expect(value.service.resolve(ordinary, reportId, 'resolved')).rejects.toBeInstanceOf(PlatformAdminAuthorizationError)
  })

  test.each(['resolved', 'dismissed'] as const)('%s records the Admin audit and exact one-year retention date', async (disposition) => {
    const value = await fixture()
    await value.service.submit(value.reporterId, input('stream', value.streamId, value.roomId))
    const reportId = (await value.service.list(value.admin))[0]!.id
    const result = await value.service.resolve(value.admin, reportId, disposition)
    expect(result).toMatchObject({
      status: 'updated',
      report: {
        status: disposition,
        resolvedAt: value.now,
        retainUntil: new Date('2027-08-01T10:00:00.000Z'),
      },
    })
    await expect(value.pool.query(
      'SELECT admin_account_id, action, created_at FROM report_audit WHERE report_id = $1',
      [reportId],
    )).resolves.toMatchObject({ rows: [{ admin_account_id: value.admin.accountId, action: disposition, created_at: value.now }] })
    expect(value.logs.at(-1)).toMatchObject({
      event: `admin.report.${disposition}`,
      report_id: reportId,
      admin_account_id: value.admin.accountId,
    })
    expect(JSON.stringify(value.logs)).not.toContain('Structured review details')
    expect(await value.service.resolve(value.admin, reportId, disposition)).toMatchObject({ status: 'already-reviewed' })
  })
})
