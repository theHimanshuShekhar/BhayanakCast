import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { afterEach, describe, expect, test } from 'vitest'
import { migrateAuthDatabase } from '../../src/server/db/migrate'
import { RoomService } from '../../src/server/rooms/room-service'
import { getIntegrationContext } from '../setup/integration'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

interface Fixture {
  pool: Pool
  valkey: Redis
  valkeyPrefix: string
  service: RoomService
  now: { value: number }
  homeEvents: Array<{ readonly type: string; readonly roomId?: string }>
  revokedConnections: string[]
  account(): Promise<string>
  close(): Promise<void>
}

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

async function createFixture(): Promise<Fixture> {
  const context = await getIntegrationContext()
  const pool = new Pool({
    connectionString: context.environment.databaseUrl,
    application_name: `room-persistence-${context.workerId}`,
    options: `-c search_path=${context.environment.schema},public`,
  })
  await migrateAuthDatabase(pool, context.environment.schema)
  const valkey = new Redis(context.environment.valkeyUrl, {
    lazyConnect: true,
    keyPrefix: '',
    maxRetriesPerRequest: 1,
  })
  await valkey.connect()
  const now = { value: Math.max(Date.now(), context.environment.clock.now()) }
  const revokedConnections: string[] = []
  const homeEvents: Array<{ readonly type: string; readonly roomId?: string }> = []
  const service = new RoomService({
    pool,
    valkey,
    valkeyPrefix: `${context.environment.valkeyPrefix}room:`,
    now: () => new Date(now.value),
    revokeConnections: async (accountId) => {
      revokedConnections.push(accountId)
    },
    publishHomeEvent: (event) => homeEvents.push(event),
  })
  const fixture: Fixture = {
    pool,
    valkey,
    service,
    valkeyPrefix: `${context.environment.valkeyPrefix}room:`,
    now,
    revokedConnections,
    homeEvents,
    async account() {
      const id = randomUUID()
      await pool.query(
        'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, false, now(), now())',
        [id, `Member ${id.slice(0, 8)}`, `${id}@example.test`],
      )
      return id
    },
    async close() {
      await Promise.all([pool.end(), valkey.quit()])
    },
  }
  fixtures.push(fixture)
  return fixture
}

function created(result: Awaited<ReturnType<RoomService['createRoom']>>) {
  expect(result.status).toBe('created')
  if (result.status !== 'created') throw new Error(`Expected created, got ${result.status}`)
  return result
}
async function leaveConfirmed(service: RoomService, accountId: string) {
  const initial = await service.leave(accountId)
  if (initial.status !== 'confirmation-required') return initial
  return service.leave(accountId, { confirmation: initial.confirmation })
}


async function waitForRoomLockContention(pool: Pool) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity
          WHERE application_name LIKE 'room-persistence-%'
            AND wait_event_type = 'Lock'
       ) AS blocked`,
    )
    if (result.rows[0]?.blocked) return
    await wait(5)
  }
  throw new Error('Admission did not reach the locked room row')
}

describe('room persistence and admission', () => {
  test('uses opaque IDs, allows duplicate names, and enters each creator as Host', async () => {
    const fixture = await createFixture()
    const [firstAccount, secondAccount] = await Promise.all([
      fixture.account(),
      fixture.account(),
    ])

    const first = created(
      await fixture.service.createRoom(firstAccount, { name: '  Movie Night  ' }),
    )
    const second = created(
      await fixture.service.createRoom(secondAccount, { name: 'Movie Night' }),
    )

    expect(first.room).toMatchObject({ name: 'Movie Night', visibility: 'public' })
    expect(first.membership).toMatchObject({ accountId: firstAccount, role: 'host' })
    expect(second.membership).toMatchObject({ accountId: secondAccount, role: 'host' })
    expect(first.room.id).not.toBe(second.room.id)
    expect(first.room.id).not.toContain(firstAccount)

    await expect(
      fixture.service.inspectPreAdmission(first.room.id, null),
    ).resolves.toMatchObject({
      status: 'active',
      visibility: 'public',
      memberCount: 1,
      admission: 'open',
    })
  })

  test('persists an optional description and carries it onto every room projection', async () => {
    const fixture = await createFixture()
    const [owner, visitor] = await Promise.all([fixture.account(), fixture.account()])

    const withBlurb = created(
      await fixture.service.createRoom(owner, {
        name: 'Described room',
        description: '  Weekly\n  horror double feature.  ',
      }),
    )
    expect(withBlurb.room.description).toBe('Weekly horror double feature.')

    // ADR 0060: the blurb is public, so pre-admission sees it too.
    await expect(
      fixture.service.inspectRouteProjection(withBlurb.room.id, visitor),
    ).resolves.toMatchObject({
      kind: 'preAdmission',
      room: { description: 'Weekly horror double feature.' },
    })
    await expect(
      fixture.service.inspectRouteProjection(withBlurb.room.id, owner),
    ).resolves.toMatchObject({
      kind: 'admitted',
      room: { description: 'Weekly horror double feature.' },
    })

    const withoutBlurb = created(
      await fixture.service.createRoom(await fixture.account(), { name: 'Plain room' }),
    )
    expect(withoutBlurb.room.description).toBeNull()
    await expect(
      fixture.service.inspectRouteProjection(withoutBlurb.room.id, null),
    ).resolves.toMatchObject({ room: { description: null } })
  })

  test('enforces private passwords and the ten-member capacity without mutating failed callers', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const room = created(
      await fixture.service.createRoom(owner, {
        name: 'Private clubhouse',
        visibility: 'private',
        password: 'correct horse',
      }),
    ).room
    const storedPassword = await fixture.pool.query(
      'SELECT password_hash FROM room WHERE id = $1',
      [room.id],
    )
    expect(storedPassword.rows[0]?.password_hash).not.toContain('correct horse')
    await expect(fixture.service.admit(owner, room.id)).resolves.toMatchObject({
      status: 'already-member',
    })

    const wrongPasswordAccount = await fixture.account()
    await expect(
      fixture.service.inspectRouteProjection(room.id, wrongPasswordAccount),
    ).resolves.toMatchObject({
      kind: 'preAdmission',
      room: {
        visibility: 'private',
        admission: 'password-required',
        memberCount: 1,
        capacity: 10,
      },
    })
    await expect(
      fixture.service.admit(wrongPasswordAccount, room.id, {
        password: 'wrong password',
      }),
    ).resolves.toMatchObject({ status: 'invalid-password' })
    await expect(
      fixture.service.currentMembership(wrongPasswordAccount),
    ).resolves.toBeNull()

    const contenders = await Promise.all(
      Array.from({ length: 10 }, () => fixture.account()),
    )
    const admissions = await Promise.all(
      contenders.map((accountId) =>
        fixture.service.admit(accountId, room.id, {
          password: 'correct horse',
        }),
      ),
    )
    expect(admissions.map((result) => result.status).sort()).toEqual([
      'full',
      ...Array.from({ length: 9 }, () => 'joined'),
    ])
    const rejectedAccount = contenders[admissions.findIndex(
      (result) => result.status === 'full',
    )]
    await expect(
      fixture.service.currentMembership(rejectedAccount),
    ).resolves.toBeNull()
    await expect(
      fixture.service.inspectPreAdmission(room.id, rejectedAccount),
    ).resolves.toMatchObject({ memberCount: 10, admission: 'full' })
    await expect(
      fixture.service.inspectRouteProjection(room.id, rejectedAccount),
    ).resolves.toMatchObject({
      kind: 'preAdmission',
      room: {
        visibility: 'private',
        admission: 'full',
        memberCount: 10,
        capacity: 10,
      },
    })
  })


  test('private room service projections never expose password material', async () => {
    const fixture = await createFixture()
    const [owner, member] = await Promise.all([fixture.account(), fixture.account()])
    const result = created(await fixture.service.createRoom(owner, {
      name: 'Real private room',
      visibility: 'private',
      password: 'correct horse battery',
    }))
    expect(JSON.stringify(result)).not.toContain('correct horse battery')
    expect(JSON.stringify(result)).not.toContain('passwordHash')
    const boundary = await fixture.service.inspectRouteProjection(result.room.id, member)
    expect(JSON.stringify(boundary)).not.toContain('correct horse battery')
    expect(JSON.stringify(boundary)).not.toContain('passwordHash')
    await expect(
      fixture.service.admit(member, result.room.id),
    ).resolves.toMatchObject({ status: 'password-required' })
    await expect(
      fixture.service.admit(member, result.room.id, { password: 'correct horse battery' }),
    ).resolves.toMatchObject({ status: 'joined' })
    const stored = await fixture.pool.query<{ passwordHash: string | null }>(
      'SELECT password_hash AS "passwordHash" FROM room WHERE id = $1',
      [result.room.id],
    )
    expect(stored.rows[0]?.passwordHash).toBeTruthy()
    expect(stored.rows[0]?.passwordHash).not.toContain('correct horse battery')
  })

  test('projects canonical admitted, forced-departure, ended, and missing states', async () => {
    const fixture = await createFixture()
    const [owner, member] = await Promise.all([fixture.account(), fixture.account()])
    const room = created(await fixture.service.createRoom(owner, { name: 'Projection lifecycle' }))

    await expect(
      fixture.service.inspectRouteProjection(room.room.id, owner),
    ).resolves.toMatchObject({ kind: 'admitted', self: { role: 'host' } })
    await expect(
      fixture.service.inspectRouteProjection(room.room.id, member),
    ).resolves.toMatchObject({ kind: 'preAdmission', room: { admission: 'open' } })

    await expect(fixture.service.admit(member, room.room.id)).resolves.toMatchObject({ status: 'joined' })
    await expect(
      fixture.service.inspectRouteProjection(room.room.id, member),
    ).resolves.toMatchObject({ kind: 'admitted', self: { role: 'member' } })
    await expect(
      fixture.service.banAccount(owner, room.room.id, member),
    ).resolves.toMatchObject({ status: 'banned' })
    await expect(
      fixture.service.inspectRouteProjection(room.room.id, member),
    ).resolves.toMatchObject({ kind: 'preAdmission' })

    await fixture.pool.query(
      'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $2, $3, $4)',
      [randomUUID(), room.room.id, room.membership.id, new Date(fixture.now.value)],
    )
    fixture.now.value += 12 * HOUR_MS + 1
    await expect(
      fixture.service.inspectRouteProjection(room.room.id, owner),
    ).resolves.toMatchObject({
      kind: 'pastStream',
      room: { memberCount: 2, streamCount: 1 },
    })
    await expect(
      fixture.service.inspectRouteProjection(randomUUID(), owner),
    ).resolves.toBeNull()
  })

  test('projects only public archived capture timestamps on ended Room routes', async () => {
    const fixture = await createFixture()
    const [publicOwner, privateOwner, noCaptureOwner] = await Promise.all([
      fixture.account(),
      fixture.account(),
      fixture.account(),
    ])
    const publicRoom = created(
      await fixture.service.createRoom(publicOwner, { name: 'Public archive route' }),
    )
    const privateRoom = created(
      await fixture.service.createRoom(privateOwner, {
        name: 'Private archive route',
        visibility: 'private',
        password: 'correct horse battery',
      }),
    )
    const noCaptureRoom = created(
      await fixture.service.createRoom(noCaptureOwner, { name: 'No capture route' }),
    )
    const capturedAt = new Date(fixture.now.value - MINUTE_MS)
    for (const room of [publicRoom, privateRoom]) {
      const streamId = randomUUID()
      await fixture.pool.query(
        `INSERT INTO stream
           (id, room_id, membership_id, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          streamId,
          room.room.id,
          room.membership.id,
          new Date(fixture.now.value - 2 * MINUTE_MS),
          new Date(fixture.now.value),
        ],
      )
      await fixture.pool.query(
        `INSERT INTO past_stream_thumbnail
           (room_id, stream_id, bytes, captured_at)
         VALUES ($1, $2, decode('00', 'hex'), $3)`,
        [room.room.id, streamId, capturedAt],
      )
    }
    await fixture.pool.query(
      `UPDATE room
          SET ended_at = $2
        WHERE id = ANY($1::uuid[])`,
      [
        [publicRoom.room.id, privateRoom.room.id, noCaptureRoom.room.id],
        new Date(fixture.now.value),
      ],
    )

    const publicProjection = await fixture.service.inspectRouteProjection(
      publicRoom.room.id,
      null,
    )
    expect(publicProjection).toMatchObject({
      kind: 'pastStream',
      room: { thumbnailCapturedAt: capturedAt },
    })
    expect(JSON.stringify(publicProjection)).not.toContain('bytes')
    await expect(
      fixture.service.inspectRouteProjection(privateRoom.room.id, null),
    ).resolves.toMatchObject({
      kind: 'pastStream',
      room: { thumbnailCapturedAt: null },
    })
    await expect(
      fixture.service.inspectRouteProjection(noCaptureRoom.room.id, null),
    ).resolves.toMatchObject({
      kind: 'pastStream',
      room: { thumbnailCapturedAt: null },
    })
  })

  test('rechecks a target that becomes private while admission waits for its lock', async () => {
    const fixture = await createFixture()
    const [sourceOwner, targetOwner] = await Promise.all([
      fixture.account(),
      fixture.account(),
    ])
    const source = created(
      await fixture.service.createRoom(sourceOwner, { name: 'Locked source' }),
    )
    const target = created(
      await fixture.service.createRoom(targetOwner, { name: 'Locked target' }),
    )
    const client = await fixture.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM room WHERE id = $1 FOR UPDATE', [target.room.id])
      const admission = fixture.service.admit(sourceOwner, target.room.id)
      await waitForRoomLockContention(fixture.pool)
      await client.query(
        `UPDATE room
            SET visibility = 'private', password_hash = 'placeholder'
          WHERE id = $1`,
        [target.room.id],
      )
      await client.query('COMMIT')
      await expect(admission).resolves.toMatchObject({ status: 'password-required' })
    } finally {
      await client.release()
    }
    await expect(fixture.service.currentMembership(sourceOwner)).resolves.toMatchObject({
      id: source.membership.id,
    })
  })

  test('rejects a confirmation issued for changed source consequences and command', async () => {
    const fixture = await createFixture()
    const [switchingAccount, targetOwner] = await Promise.all([
      fixture.account(),
      fixture.account(),
    ])
    const original = created(
      await fixture.service.createRoom(switchingAccount, {
        name: 'Original source',
      }),
    )
    const target = created(
      await fixture.service.createRoom(targetOwner, { name: 'Target room' }),
    )
    const originalConfirmation = await fixture.service.createRoom(
      switchingAccount,
      { name: 'First replacement' },
    )
    if (originalConfirmation.status !== 'confirmation-required') {
      throw new Error('Expected original create confirmation')
    }
    await fixture.pool.query(
      `INSERT INTO stream (id, room_id, membership_id, started_at)
       VALUES ($1, $2, $3, $4)`,
      [
        randomUUID(),
        original.room.id,
        original.membership.id,
        new Date(fixture.now.value),
      ],
    )
    const changedConsequences = await fixture.service.createRoom(
      switchingAccount,
      { name: 'First replacement' },
      { confirmation: originalConfirmation.confirmation },
    )
    expect(changedConsequences).toMatchObject({
      status: 'confirmation-required',
      consequences: ['transfer-host', 'stop-stream'],
    })
    if (changedConsequences.status !== 'confirmation-required') {
      throw new Error('Expected changed source consequence confirmation')
    }
    const replacement = created(
      await fixture.service.createRoom(
        switchingAccount,
        { name: 'First replacement' },
        { confirmation: changedConsequences.confirmation },
      ),
    )

    const staleAttempt = await fixture.service.admit(
      switchingAccount,
      target.room.id,
      { confirmation: originalConfirmation.confirmation },
    )
    expect(staleAttempt).toMatchObject({
      status: 'confirmation-required',
      confirmation: { sourceMembershipId: replacement.membership.id },
    })
    await expect(
      fixture.service.currentMembership(switchingAccount),
    ).resolves.toMatchObject({ id: replacement.membership.id })
  })

  test('rejects forged and replayed confirmation tokens on the same source', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const source = created(await fixture.service.createRoom(owner, { name: 'Token source' }))
    const required = await fixture.service.createRoom(owner, { name: 'Token replacement' })
    if (required.status !== 'confirmation-required') throw new Error('Expected confirmation')
    const key = `${fixture.valkeyPrefix}:room-confirmation:${required.confirmation.token}`
    const forged = {
      ...required.confirmation,
      token: randomUUID(),
      issuedAt: new Date(fixture.now.value),
    }
    await expect(
      fixture.service.createRoom(owner, { name: 'Forged replacement' }, { confirmation: forged }),
    ).resolves.toMatchObject({ status: 'confirmation-required' })
    await expect(fixture.service.currentMembership(owner)).resolves.toMatchObject({
      id: source.membership.id,
    })

    const confirmed = created(
      await fixture.service.createRoom(owner, { name: 'Token replacement' }, {
        confirmation: required.confirmation,
      }),
    )
    await expect(fixture.valkey.exists(key)).resolves.toBe(0)
    await fixture.pool.query(
      'DELETE FROM room_membership WHERE id = $1',
      [confirmed.membership.id],
    )
    await fixture.pool.query(
      'UPDATE room_membership SET left_at = NULL WHERE id = $1',
      [source.membership.id],
    )
    await fixture.pool.query('DELETE FROM room WHERE id = $1', [confirmed.room.id])
    await expect(fixture.service.currentMembership(owner)).resolves.toMatchObject({
      id: source.membership.id,
    })
    await expect(
      fixture.service.createRoom(owner, { name: 'Token replacement' }, {
        confirmation: required.confirmation,
      }),
    ).resolves.toMatchObject({ status: 'confirmation-required' })
    await expect(fixture.valkey.exists(key)).resolves.toBe(0)
  })

  test('ends an overdue source before creating a replacement without confirmation', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const source = created(
      await fixture.service.createRoom(owner, { name: 'Expiring source' }),
    )
    fixture.now.value += 12 * HOUR_MS + 1

    const replacement = created(
      await fixture.service.createRoom(owner, { name: 'After expiry' }),
    )
    expect(replacement.membership.roomId).not.toBe(source.room.id)
    const ended = await fixture.pool.query<{ endedAt: Date | null }>(
      'SELECT ended_at AS "endedAt" FROM room WHERE id = $1',
      [source.room.id],
    )
    expect(ended.rows[0]?.endedAt).toEqual(source.room.expiresAt)
  })

  test('ends an overdue room instead of inserting a late room ban', async () => {
    const fixture = await createFixture()
    const [owner, member] = await Promise.all([
      fixture.account(),
      fixture.account(),
    ])
    const active = created(
      await fixture.service.createRoom(owner, { name: 'Expiring moderation' }),
    )
    await fixture.service.admit(member, active.room.id)
    fixture.now.value += 12 * HOUR_MS + 1

    await expect(
      fixture.service.banAccount(owner, active.room.id, member),
    ).resolves.toEqual({ status: 'ended' })
    const result = await fixture.pool.query<{
      endedAt: Date | null
      banCount: number
    }>(
      `SELECT room.ended_at AS "endedAt",
              count(ban.id)::int AS "banCount"
         FROM room
         LEFT JOIN room_ban ban ON ban.room_id = room.id
        WHERE room.id = $1
        GROUP BY room.id`,
      [active.room.id],
    )
    expect(result.rows[0]).toEqual({
      endedAt: active.room.expiresAt,
      banCount: 0,
    })
  })

  test('denies anonymous, deletion-pending, creation-sanctioned, and room-banned participation', async () => {
    const fixture = await createFixture()
    await expect(
      fixture.service.createRoom(null, { name: 'Anonymous room' }),
    ).resolves.toMatchObject({ status: 'unauthenticated' })

    const owner = await fixture.account()
    const room = created(
      await fixture.service.createRoom(owner, { name: 'Safety room' }),
    ).room
    await expect(fixture.service.admit(null, room.id)).resolves.toMatchObject({
      status: 'unauthenticated',
    })

    const deletionPending = await fixture.account()
    await fixture.service.admit(deletionPending, room.id)
    await fixture.service.setDeletionPending(deletionPending, true)
    await expect(
      fixture.service.currentMembership(deletionPending),
    ).resolves.toBeNull()
    await expect(
      fixture.service.createRoom(deletionPending, { name: 'Blocked room' }),
    ).resolves.toMatchObject({ status: 'account-read-only' })
    await expect(
      fixture.service.admit(deletionPending, room.id),
    ).resolves.toMatchObject({ status: 'account-read-only' })

    const creationSanctioned = await fixture.account()
    await fixture.service.applySanction({
      accountId: creationSanctioned,
      type: 'room_creation',
      expiresAt: new Date(fixture.now.value + HOUR_MS),
    })
    await expect(
      fixture.service.createRoom(creationSanctioned, { name: 'Blocked creation' }),
    ).resolves.toMatchObject({ status: 'room-creation-sanctioned' })
    await expect(
      fixture.service.admit(creationSanctioned, room.id),
    ).resolves.toMatchObject({ status: 'joined' })

    const banned = await fixture.account()
    await expect(fixture.service.admit(banned, room.id)).resolves.toMatchObject({
      status: 'joined',
    })
    await expect(
      fixture.service.banAccount(owner, room.id, banned),
    ).resolves.toMatchObject({ status: 'banned' })
    await expect(fixture.service.admit(banned, room.id)).resolves.toMatchObject({
      status: 'banned',
    })

    await expect(
      fixture.service.clearBan(owner, room.id, banned),
    ).resolves.toMatchObject({ status: 'cleared' })
    await expect(fixture.service.admit(banned, room.id)).resolves.toMatchObject({
      status: 'joined',
    })
  })

  test('publishes a committed room-ended transition when clearBan closes a due room', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const banned = await fixture.account()
    const room = created(
      await fixture.service.createRoom(owner, { name: 'Due clear-ban room' }),
    )
    await fixture.service.admit(banned, room.room.id)
    await fixture.service.banAccount(owner, room.room.id, banned)
    fixture.homeEvents.length = 0
    fixture.now.value = room.room.createdAt.getTime() + 12 * HOUR_MS

    await expect(
      fixture.service.clearBan(owner, room.room.id, banned),
    ).resolves.toMatchObject({ status: 'ended' })
    expect(fixture.homeEvents).toContainEqual({
      type: 'room-ended',
      roomId: room.room.id,
    })
  })


  test('defaults Platform Sanctions to seven days while preserving explicit indefinite expiry', async () => {
    const fixture = await createFixture()
    const account = await fixture.account()
    await fixture.service.applySanction({
      accountId: account,
      type: 'room_creation',
    })
    await fixture.service.applySanction({
      accountId: account,
      type: 'room_creation',
      expiresAt: null,
    })
    const sanctions = await fixture.pool.query<{
      startsAt: Date
      expiresAt: Date | null
    }>(
      `SELECT starts_at AS "startsAt", expires_at AS "expiresAt"
         FROM platform_sanction
        WHERE account_id = $1
        ORDER BY id`,
      [account],
    )
    const expiring = sanctions.rows.find((sanction) => sanction.expiresAt !== null)
    if (!expiring?.expiresAt) throw new Error('Expected default sanction expiry')
    expect(expiring.expiresAt.getTime() - expiring.startsAt.getTime()).toBe(
      7 * 24 * HOUR_MS,
    )
    expect(sanctions.rows.some((sanction) => sanction.expiresAt === null)).toBe(
      true,
    )
  })
  test('all-access sanctions revoke sessions and connections and run ordinary departure lifecycle', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const member = await fixture.account()
    const room = created(
      await fixture.service.createRoom(owner, { name: 'Sanction room' }),
    ).room
    await fixture.service.admit(member, room.id)
    await fixture.pool.query(
      'INSERT INTO session (id, token, expires_at, user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())',
      [randomUUID(), randomUUID(), new Date(fixture.now.value + HOUR_MS), member],
    )

    await expect(
      fixture.service.applySanction({
        accountId: member,
        type: 'all_access',
        expiresAt: new Date(fixture.now.value + HOUR_MS),
      }),
    ).resolves.toMatchObject({ status: 'applied', removedFromRoom: true })

    await expect(fixture.service.currentMembership(member)).resolves.toBeNull()
    const sessions = await fixture.pool.query(
      'SELECT count(*)::int AS count FROM session WHERE user_id = $1',
      [member],
    )
    expect(sessions.rows[0]?.count).toBe(0)
    expect(fixture.revokedConnections).toEqual([member])
    await expect(
      fixture.service.admit(member, room.id),
    ).resolves.toMatchObject({ status: 'all-access-sanctioned' })
  })

  test('serializes all-access sanctions with admission so no membership survives', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const entrant = await fixture.account()
    const room = created(
      await fixture.service.createRoom(owner, { name: 'Concurrent sanction room' }),
    ).room
    const blocker = await fixture.pool.connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT id FROM room WHERE id = $1 FOR UPDATE', [room.id])
      const admission = fixture.service.admit(entrant, room.id)
      await waitForRoomLockContention(fixture.pool)
      const sanction = fixture.service.applySanction({
        accountId: entrant,
        type: 'all_access',
        expiresAt: new Date(fixture.now.value + HOUR_MS),
      })
      await blocker.query('COMMIT')
      await Promise.all([admission, sanction])
      await expect(fixture.service.currentMembership(entrant)).resolves.toBeNull()
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined)
      blocker.release()
    }
  })


  test('serializes simultaneous final departures without deadlocking', async () => {
    const fixture = await createFixture()
    const [owner, member] = await Promise.all([
      fixture.account(),
      fixture.account(),
    ])
    const room = created(
      await fixture.service.createRoom(owner, { name: 'Concurrent departures' }),
    ).room
    await fixture.service.admit(member, room.id)
    const ownerConfirmation = await fixture.service.leave(owner)
    if (ownerConfirmation.status !== 'confirmation-required') {
      throw new Error('Expected Host departure confirmation')
    }

    const departures = await Promise.all([
      fixture.service.leave(owner, {
        confirmation: ownerConfirmation.confirmation,
      }),
      fixture.service.leave(member),
    ])
    expect(departures[0].status).toBe('left')
    if (departures[1].status === 'confirmation-required') {
      await expect(
        fixture.service.leave(member, {
          confirmation: departures[1].confirmation,
        }),
      ).resolves.toMatchObject({ status: 'left' })
    } else {
      expect(departures[1].status).toBe('left')
    }
    await expect(
      fixture.service.inspectPreAdmission(room.id, null),
    ).resolves.toMatchObject({ status: 'empty-grace', memberCount: 0 })
  })

  test('records an overdue departure at the immutable room deadline', async () => {
    const fixture = await createFixture()
    const owner = await fixture.account()
    const bannedMember = await fixture.account()
    const createdRoom = created(
      await fixture.service.createRoom(owner, { name: 'Overdue departure' }),
    )
    await fixture.service.admit(bannedMember, createdRoom.room.id)
    await fixture.service.banAccount(
      owner,
      createdRoom.room.id,
      bannedMember,
    )
    fixture.now.value += 12 * HOUR_MS + 1

    await expect(
      leaveConfirmed(fixture.service, owner),
    ).resolves.toMatchObject({ status: 'left', roomState: 'ended' })
    const persisted = await fixture.pool.query<{
      endedAt: Date | null
      leftAt: Date | null
      banClearedAt: Date | null
    }>(
      `SELECT room.ended_at AS "endedAt",
              membership.left_at AS "leftAt",
              ban.cleared_at AS "banClearedAt"
         FROM room
         JOIN room_membership membership
           ON membership.room_id = room.id
          AND membership.account_id = $2
         JOIN room_ban ban
           ON ban.room_id = room.id
          AND ban.account_id = $3
        WHERE room.id = $1`,
      [createdRoom.room.id, owner, bannedMember],
    )
    expect(persisted.rows[0]?.endedAt).toEqual(createdRoom.room.expiresAt)
    expect(persisted.rows[0]?.leftAt).toEqual(createdRoom.room.expiresAt)
    expect(persisted.rows[0]?.banClearedAt).toEqual(createdRoom.room.expiresAt)
  })
  test('hands Host authority to the longest continuously present remaining member', async () => {
    const fixture = await createFixture()
    const [owner, longestPresent, laterMember] = await Promise.all([
      fixture.account(),
      fixture.account(),
      fixture.account(),
    ])
    const room = created(
      await fixture.service.createRoom(owner, { name: 'Handoff room' }),
    ).room
    await fixture.service.admit(longestPresent, room.id)
    fixture.now.value += 1
    await fixture.service.admit(laterMember, room.id)

    await expect(fixture.service.leave(owner)).resolves.toMatchObject({
      status: 'confirmation-required',
      consequences: ['transfer-host'],
    })
    await leaveConfirmed(fixture.service, owner)

    await expect(
      fixture.service.currentMembership(longestPresent),
    ).resolves.toMatchObject({ role: 'host' })
    await expect(
      fixture.service.currentMembership(laterMember),
    ).resolves.toMatchObject({ role: 'member' })
  })

  test('revives during five-minute empty grace and ends at grace or the immutable twelve-hour deadline', async () => {
    const fixture = await createFixture()
    const firstOwner = await fixture.account()
    const firstRoom = created(
      await fixture.service.createRoom(firstOwner, { name: 'Grace room' }),
    ).room
    await expect(
      leaveConfirmed(fixture.service, firstOwner),
    ).resolves.toMatchObject({ status: 'left', roomState: 'empty-grace' })

    fixture.now.value += 5 * MINUTE_MS - 1
    const reviver = await fixture.account()
    await expect(
      fixture.service.admit(reviver, firstRoom.id),
    ).resolves.toMatchObject({ status: 'joined', role: 'host', revived: true })

    const secondOwner = await fixture.account()
    const secondRoom = created(
      await fixture.service.createRoom(secondOwner, { name: 'Expiring empty room' }),
    ).room
    await leaveConfirmed(fixture.service, secondOwner)
    fixture.now.value += 5 * MINUTE_MS
    await fixture.service.endDueRooms()
    await expect(
      fixture.service.inspectPreAdmission(secondRoom.id, null),
    ).resolves.toMatchObject({ status: 'ended', admission: 'ended' })

    fixture.now.value += 12 * HOUR_MS
    await fixture.service.endDueRooms()
    await expect(
      fixture.service.inspectPreAdmission(firstRoom.id, reviver),
    ).resolves.toMatchObject({ status: 'ended', admission: 'ended' })
    const ended = await fixture.pool.query<{ endedAt: Date }>(
      'SELECT ended_at AS "endedAt" FROM room WHERE id = $1',
      [firstRoom.id],
    )
    expect(ended.rows[0]?.endedAt).toEqual(firstRoom.expiresAt)
  })
})
