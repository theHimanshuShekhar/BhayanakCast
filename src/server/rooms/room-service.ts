import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import type Redis from 'ioredis'
import type { Pool, PoolClient } from 'pg'
import {
  consumePrivatePasswordLimit,
  consumeRoomCreationLimit,
} from '../rate-limits/room-limits'
import {
  EMPTY_GRACE_MS,
  endRoom,
  ROOM_LIFETIME_MS,
  roomEndDeadline,
} from './end-room'
import {
  normalizeRoomInput,
  type RoomInput,
  type RoomVisibility,
} from './room-policy'
import {
  type CurrentMembership,
  RoomRepository,
  type RoomRecord,
} from './room-repository'

const ROOM_CAPACITY = 10
const SANCTION_DEFAULT_MS = 7 * 24 * 60 * 60 * 1_000
const deriveKey = promisify(scryptCallback)

type Consequence = 'transfer-host' | 'stop-stream'
type Restriction =
  | 'account-read-only'
  | 'room-creation-sanctioned'
  | 'all-access-sanctioned'

export interface RoomProjection {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly tags: readonly string[]
  readonly visibility: RoomVisibility
  readonly createdAt: Date
  readonly expiresAt: Date
}

export interface MembershipProjection {
  readonly id: string
  readonly roomId: string
  readonly accountId: string
  readonly role: 'host' | 'member'
  readonly joinedAt: Date
}

export interface MembershipConfirmation {
  readonly sourceMembershipId: string
  readonly consequences: readonly Consequence[]
}

interface ConfirmationRequired {
  readonly status: 'confirmation-required'
  readonly consequences: readonly Consequence[]
  readonly confirmation: MembershipConfirmation
}

export type CreateRoomResult =
  | {
      readonly status: 'created'
      readonly room: RoomProjection
      readonly membership: MembershipProjection
    }
  | { readonly status: 'unauthenticated' }
  | { readonly status: Restriction }
  | { readonly status: 'rate-limited'; readonly retryAfterSeconds: number }
  | { readonly status: 'rate-limit-unavailable' }
  | ConfirmationRequired

export interface AdmitOptions {
  readonly password?: string
  readonly clientIp?: string
  readonly confirmation?: MembershipConfirmation
}

export type AdmitResult =
  | {
      readonly status: 'joined'
      readonly membership: MembershipProjection
      readonly role: 'host' | 'member'
      readonly revived: boolean
    }
  | { readonly status: 'already-member'; readonly membership: MembershipProjection }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'account-read-only' | 'all-access-sanctioned' }
  | { readonly status: 'not-found' | 'ended' | 'full' | 'banned' }
  | { readonly status: 'password-required' | 'invalid-password' }
  | { readonly status: 'rate-limited'; readonly retryAfterSeconds: number }
  | { readonly status: 'rate-limit-unavailable' }
  | ConfirmationRequired

export type LeaveResult =
  | { readonly status: 'not-member' }
  | ConfirmationRequired
  | {
      readonly status: 'left'
      readonly roomState: 'active' | 'empty-grace' | 'ended'
    }

export type RoomInspection =
  | { readonly status: 'not-found' }
  | {
      readonly status: 'active' | 'empty-grace' | 'ended'
      readonly id: string
      readonly name: string
      readonly category: string | null
      readonly tags: readonly string[]
      readonly visibility: RoomVisibility
      readonly memberCount: number
      readonly expiresAt: Date
      readonly admission: 'open' | 'password-required' | 'full' | 'member' | 'ended'
    }

export type SanctionType = 'room_creation' | 'all_access'

export interface RoomServiceConfiguration {
  readonly pool: Pool
  readonly valkey: Redis
  readonly valkeyPrefix: string
  readonly now?: () => Date
  readonly revokeConnections: (accountId: string) => Promise<void> | void
}

export class RoomService {
  private readonly repository: RoomRepository
  private readonly now: () => Date
  private readonly revokeConnections: (accountId: string) => Promise<void> | void

  constructor(private readonly configuration: RoomServiceConfiguration) {
    this.repository = new RoomRepository(configuration.pool)
    this.now = configuration.now ?? (() => new Date())
    this.revokeConnections = configuration.revokeConnections
  }

  async createRoom(
    accountId: string | null,
    input: RoomInput,
    options: { readonly confirmation?: MembershipConfirmation } = {},
  ): Promise<CreateRoomResult> {
    if (!accountId) return { status: 'unauthenticated' }
    const normalized = normalizeRoomInput(input)
    const restriction = await this.restriction(accountId, true)
    if (restriction) return { status: restriction }

    const current = await this.repository.currentMembership(accountId)
    const currentRoom = current
      ? await this.repository.room(current.roomId)
      : null
    if (
      current &&
      currentRoom &&
      !currentRoom.endedAt &&
      roomEndDeadline(currentRoom).getTime() > this.now().getTime() &&
      !options.confirmation
    ) {
      const consequences = await this.sourceConsequences(
        this.configuration.pool,
        current,
      )
      if (consequences.length > 0) {
        return this.confirmationRequired(current, consequences)
      }
    }

    const limit = await consumeRoomCreationLimit(
      this.configuration.valkey,
      this.configuration.valkeyPrefix,
      accountId,
    )
    if (limit.kind === 'unavailable') return { status: 'rate-limit-unavailable' }
    if (limit.kind === 'limited') {
      return { status: 'rate-limited', retryAfterSeconds: limit.retryAfterSeconds }
    }

    const passwordHash = normalized.password
      ? await hashPassword(normalized.password)
      : null
    return this.transaction(async (client) => {
      if (!(await this.lockAccount(client, accountId))) {
        return { status: 'unauthenticated' }
      }
      const currentRestriction = await this.restriction(accountId, true, client)
      if (currentRestriction) return { status: currentRestriction }
      let lockedCurrent = await this.lockCurrentMembership(client, accountId)
      const instant = this.now()
      if (
        lockedCurrent &&
        (await this.closeRoomIfDue(client, lockedCurrent.roomId, instant))
      ) {
        lockedCurrent = null
      }
      if (lockedCurrent) {
        const consequences = await this.sourceConsequences(client, lockedCurrent)
        if (
          consequences.length > 0 &&
          !confirmationMatches(options.confirmation, lockedCurrent, consequences)
        ) {
          return this.confirmationRequired(lockedCurrent, consequences)
        }
      }

      const roomId = randomUUID()
      const membershipId = randomUUID()
      await client.query(
        `INSERT INTO room
           (id, name, category, tags, visibility, password_hash, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          roomId,
          normalized.name,
          normalized.category ?? null,
          normalized.tags,
          normalized.visibility,
          passwordHash,
          accountId,
          instant,
        ],
      )
      if (lockedCurrent) await this.depart(client, lockedCurrent, instant)
      await client.query(
        `INSERT INTO room_membership
           (id, room_id, account_id, role, joined_at)
         VALUES ($1, $2, $3, 'host', $4)`,
        [membershipId, roomId, accountId, instant],
      )
      return {
        status: 'created',
        room: roomProjection(
          {
            id: roomId,
            name: normalized.name,
            category: normalized.category ?? null,
            tags: normalized.tags,
            visibility: normalized.visibility,
            passwordHash,
            createdAt: instant,
            emptyAt: null,
            endedAt: null,
          },
        ),
        membership: {
          id: membershipId,
          roomId,
          accountId,
          role: 'host',
          joinedAt: instant,
        },
      }
    })
  }

  async admit(
    accountId: string | null,
    roomId: string,
    options: AdmitOptions = {},
  ): Promise<AdmitResult> {
    if (!accountId) return { status: 'unauthenticated' }
    const restriction = await this.restriction(accountId, false)
    if (restriction === 'account-read-only' || restriction === 'all-access-sanctioned') {
      return { status: restriction }
    }

    await this.endDueRooms()
    const initialRoom = await this.repository.room(roomId)
    if (!initialRoom) return { status: 'not-found' }
    if (initialRoom.endedAt) return { status: 'ended' }

    if (initialRoom.visibility === 'private') {
      const initialCurrent = await this.repository.currentMembership(accountId)
      if (initialCurrent?.roomId !== roomId) {
        if (!options.password) return { status: 'password-required' }
        const limit = await consumePrivatePasswordLimit(
          this.configuration.valkey,
          this.configuration.valkeyPrefix,
          {
            accountId,
            roomId,
            clientIp: options.clientIp ?? 'unknown',
          },
        )
        if (limit.kind === 'unavailable') return { status: 'rate-limit-unavailable' }
        if (limit.kind === 'limited') {
          return { status: 'rate-limited', retryAfterSeconds: limit.retryAfterSeconds }
        }
        if (
          !initialRoom.passwordHash ||
          !(await passwordMatches(options.password, initialRoom.passwordHash))
        ) {
          return { status: 'invalid-password' }
        }
      }
    }

    return this.transaction(async (client) => {
      if (!(await this.lockAccount(client, accountId))) {
        return { status: 'unauthenticated' }
      }
      const currentRestriction = await this.restriction(accountId, false, client)
      if (
        currentRestriction === 'account-read-only' ||
        currentRestriction === 'all-access-sanctioned'
      ) {
        return { status: currentRestriction }
      }
      const observedCurrent = await this.repository.currentMembership(
        accountId,
        client,
      )
      await this.lockRooms(client, [roomId, observedCurrent?.roomId])
      const instant = this.now()
      let current = await this.repository.currentMembership(accountId, client, true)
      if (
        current &&
        (await this.closeRoomIfDue(client, current.roomId, instant))
      ) {
        current = null
      }
      if (current?.roomId === roomId) {
        return { status: 'already-member', membership: membershipProjection(current) }
      }

      const target = await this.repository.room(roomId, client, true)
      if (!target) return { status: 'not-found' }
      if (target.endedAt || roomExpired(target, instant) || emptyGraceExpired(target, instant)) {
        if (!target.endedAt) {
          await endRoom(client, target.id, roomEndDeadline(target))
        }
        return { status: 'ended' }
      }

      const ban = await client.query(
        `SELECT 1 FROM room_ban
          WHERE room_id = $1 AND account_id = $2 AND cleared_at IS NULL`,
        [roomId, accountId],
      )
      if (ban.rows[0]) return { status: 'banned' }

      if (
        target.visibility === 'private' &&
        (!options.password ||
          !target.passwordHash ||
          !(await passwordMatches(options.password, target.passwordHash)))
      ) {
        return { status: options.password ? 'invalid-password' : 'password-required' }
      }

      const memberCount = await this.repository.memberCount(roomId, client)
      if (memberCount >= ROOM_CAPACITY) return { status: 'full' }

      if (current) {
        const consequences = await this.sourceConsequences(client, current)
        if (
          consequences.length > 0 &&
          !confirmationMatches(options.confirmation, current, consequences)
        ) {
          return this.confirmationRequired(current, consequences)
        }
      }

      if (current) await this.depart(client, current, instant)
      const revived = target.emptyAt !== null
      const role = revived ? 'host' : 'member'
      if (revived) {
        await client.query('UPDATE room SET empty_at = NULL WHERE id = $1', [roomId])
      }
      const membership: MembershipProjection = {
        id: randomUUID(),
        roomId,
        accountId,
        role,
        joinedAt: instant,
      }
      await client.query(
        `INSERT INTO room_membership
           (id, room_id, account_id, role, joined_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [membership.id, roomId, accountId, role, instant],
      )
      return { status: 'joined', membership, role, revived }
    })
  }

  async leave(
    accountId: string,
    options: { readonly confirmation?: MembershipConfirmation } = {},
  ): Promise<LeaveResult> {
    return this.transaction(async (client) => {
      if (!(await this.lockAccount(client, accountId))) {
        return { status: 'not-member' }
      }
      const current = await this.lockCurrentMembership(client, accountId)
      if (!current) return { status: 'not-member' }
      const instant = this.now()
      if (await this.closeRoomIfDue(client, current.roomId, instant)) {
        return { status: 'left', roomState: 'ended' }
      }
      const consequences = await this.sourceConsequences(client, current)
      if (
        consequences.length > 0 &&
        !confirmationMatches(options.confirmation, current, consequences)
      ) {
        return this.confirmationRequired(current, consequences)
      }
      const roomState = await this.depart(client, current, instant)
      return { status: 'left', roomState }
    })
  }

  async currentMembership(accountId: string): Promise<MembershipProjection | null> {
    const membership = await this.repository.currentMembership(accountId)
    return membership ? membershipProjection(membership) : null
  }

  async inspectPreAdmission(
    roomId: string,
    accountId: string | null,
  ): Promise<RoomInspection> {
    await this.endDueRooms()
    const room = await this.repository.room(roomId)
    if (!room) return { status: 'not-found' }
    const memberCount = await this.repository.memberCount(roomId)
    const current = accountId
      ? await this.repository.currentMembership(accountId)
      : null
    const status = room.endedAt ? 'ended' : room.emptyAt ? 'empty-grace' : 'active'
    const admission = room.endedAt
      ? 'ended'
      : current?.roomId === room.id
        ? 'member'
        : memberCount >= ROOM_CAPACITY
          ? 'full'
          : room.visibility === 'private'
            ? 'password-required'
            : 'open'
    return {
      status,
      id: room.id,
      name: room.name,
      category: room.category,
      tags: room.tags,
      visibility: room.visibility,
      memberCount,
      expiresAt: new Date(room.createdAt.getTime() + ROOM_LIFETIME_MS),
      admission,
    }
  }

  async setDeletionPending(accountId: string, pending: boolean) {
    await this.transaction(async (client) => {
      if (!(await this.lockAccount(client, accountId))) {
        throw new Error(`Unknown Account: ${accountId}`)
      }
      const current = pending
        ? await this.lockCurrentMembership(client, accountId)
        : null
      const instant = this.now()
      await client.query(
        `INSERT INTO account_state (account_id, deletion_requested_at)
         VALUES ($1, $2)
         ON CONFLICT (account_id)
         DO UPDATE SET deletion_requested_at = EXCLUDED.deletion_requested_at`,
        [accountId, pending ? instant : null],
      )
      if (current) await this.depart(client, current, instant)
    })
  }

  async applySanction(input: {
    readonly accountId: string
    readonly type: SanctionType
    readonly expiresAt?: Date | null
  }) {
    const removedFromRoom = await this.transaction(async (client) => {
      if (!(await this.lockAccount(client, input.accountId))) {
        throw new Error(`Unknown Account: ${input.accountId}`)
      }
      const current =
        input.type === 'all_access'
          ? await this.lockCurrentMembership(client, input.accountId)
          : null
      const instant = this.now()
      const expiresAt =
        input.expiresAt === undefined
          ? new Date(instant.getTime() + SANCTION_DEFAULT_MS)
          : input.expiresAt
      await client.query(
        `INSERT INTO platform_sanction
           (id, account_id, type, starts_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), input.accountId, input.type, instant, expiresAt],
      )
      if (input.type !== 'all_access') return false
      await client.query(
        `UPDATE "user" account
            SET all_access_blocked_indefinite = EXISTS (
                  SELECT 1
                    FROM platform_sanction
                   WHERE account_id = account.id
                     AND type = 'all_access'
                     AND starts_at <= $2
                     AND lifted_at IS NULL
                     AND expires_at IS NULL
                ),
                all_access_blocked_until = (
                  SELECT max(expires_at)
                    FROM platform_sanction
                   WHERE account_id = account.id
                     AND type = 'all_access'
                     AND starts_at <= $2
                     AND lifted_at IS NULL
                     AND expires_at > $2
                )
          WHERE id = $1`,
        [input.accountId, instant],
      )
      if (current) await this.depart(client, current, instant)
      await client.query('DELETE FROM session WHERE user_id = $1', [input.accountId])
      return current !== null
    })
    if (input.type === 'all_access') {
      await this.revokeConnections(input.accountId)
    }
    return { status: 'applied' as const, removedFromRoom }
  }

  async banAccount(hostAccountId: string, roomId: string, accountId: string) {
    if (hostAccountId === accountId) return { status: 'invalid-target' as const }
    return this.transaction(async (client) => {
      const accounts = await this.lockAccounts(client, [
        hostAccountId,
        accountId,
      ])
      if (!accounts.has(hostAccountId)) return { status: 'forbidden' as const }
      if (!accounts.has(accountId)) return { status: 'not-member' as const }
      await this.lockRooms(client, [roomId])
      const instant = this.now()
      if (await this.closeRoomIfDue(client, roomId, instant)) {
        return { status: 'ended' as const }
      }
      const host = await this.repository.currentMembership(hostAccountId, client, true)
      if (!host || host.roomId !== roomId || host.role !== 'host') {
        return { status: 'forbidden' as const }
      }
      const target = await this.repository.currentMembership(accountId, client, true)
      if (!target || target.roomId !== roomId) return { status: 'not-member' as const }
      const existing = await client.query(
        `SELECT 1 FROM room_ban
          WHERE room_id = $1 AND account_id = $2 AND cleared_at IS NULL`,
        [roomId, accountId],
      )
      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO room_ban
             (id, room_id, account_id, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), roomId, accountId, hostAccountId, instant],
        )
      }
      await this.depart(client, target, instant)
      return { status: 'banned' as const }
    })
  }

  async clearBan(hostAccountId: string, roomId: string, accountId: string) {
    return this.transaction(async (client) => {
      if (!(await this.lockAccount(client, hostAccountId))) {
        return { status: 'forbidden' as const }
      }
      await this.lockRooms(client, [roomId])
      const instant = this.now()
      if (await this.closeRoomIfDue(client, roomId, instant)) {
        return { status: 'ended' as const }
      }
      const host = await this.repository.currentMembership(hostAccountId, client, true)
      if (!host || host.roomId !== roomId || host.role !== 'host') {
        return { status: 'forbidden' as const }
      }
      const result = await client.query(
        `UPDATE room_ban
            SET cleared_at = $3
          WHERE room_id = $1 AND account_id = $2 AND cleared_at IS NULL
          RETURNING id`,
        [roomId, accountId, instant],
      )
      return { status: result.rows[0] ? ('cleared' as const) : ('not-banned' as const) }
    })
  }

  async endDueRooms() {
    const instant = this.now()
    return this.transaction(async (client) => {
      const due = await client.query<{
        id: string
        createdAt: Date
        emptyAt: Date | null
      }>(
        `SELECT id,
                created_at AS "createdAt",
                empty_at AS "emptyAt"
           FROM room
          WHERE ended_at IS NULL
            AND (
              created_at + interval '12 hours' <= $1
              OR (empty_at IS NOT NULL AND empty_at + interval '5 minutes' <= $1)
            )
          ORDER BY id
          FOR UPDATE`,
        [instant],
      )
      for (const room of due.rows) {
        await endRoom(client, room.id, roomEndDeadline(room))
      }
      return due.rows.length
    })
  }

  private async lockAccount(client: PoolClient, accountId: string) {
    const accounts = await this.lockAccounts(client, [accountId])
    return accounts.has(accountId)
  }

  private async lockAccounts(
    client: PoolClient,
    accountIds: readonly string[],
  ) {
    const ids = [...new Set(accountIds)].sort()
    const accounts = await client.query<{ id: string }>(
      `SELECT id
         FROM "user"
        WHERE id = ANY($1::text[])
        ORDER BY id
        FOR UPDATE`,
      [ids],
    )
    return new Set(accounts.rows.map((account) => account.id))
  }

  private async lockRooms(
    client: PoolClient,
    roomIds: readonly (string | undefined)[],
  ) {
    const ids = [
      ...new Set(roomIds.filter((id): id is string => Boolean(id))),
    ].sort()
    if (ids.length === 0) return
    await client.query(
      `SELECT id
         FROM room
        WHERE id = ANY($1::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [ids],
    )
  }

  private async lockCurrentMembership(
    client: PoolClient,
    accountId: string,
  ) {
    const observed = await this.repository.currentMembership(accountId, client)
    if (!observed) return null
    await this.lockRooms(client, [observed.roomId])
    return this.repository.currentMembership(accountId, client, true)
  }

  private async restriction(
    accountId: string,
    includeRoomCreation: boolean,
    executor: Pool | PoolClient = this.configuration.pool,
  ): Promise<Restriction | 'unauthenticated' | null> {
    const instant = this.now()
    const account = await executor.query<{
      deletionRequestedAt: Date | null
    }>(
      `SELECT state.deletion_requested_at AS "deletionRequestedAt"
         FROM "user" account
         LEFT JOIN account_state state ON state.account_id = account.id
        WHERE account.id = $1`,
      [accountId],
    )
    if (!account.rows[0]) return 'unauthenticated'
    if (account.rows[0].deletionRequestedAt) return 'account-read-only'

    const sanctions = await executor.query<{ type: SanctionType }>(
      `SELECT type
         FROM platform_sanction
        WHERE account_id = $1
          AND starts_at <= $2
          AND lifted_at IS NULL
          AND (expires_at IS NULL OR expires_at > $2)`,
      [accountId, instant],
    )
    if (sanctions.rows.some((row) => row.type === 'all_access')) {
      return 'all-access-sanctioned'
    }
    if (
      includeRoomCreation &&
      sanctions.rows.some((row) => row.type === 'room_creation')
    ) {
      return 'room-creation-sanctioned'
    }
    return null
  }

  private async sourceConsequences(
    executor: Pool | PoolClient,
    membership: CurrentMembership,
  ): Promise<Consequence[]> {
    const consequences: Consequence[] = []
    if (membership.role === 'host') consequences.push('transfer-host')
    const stream = await executor.query(
      'SELECT 1 FROM stream WHERE membership_id = $1 AND ended_at IS NULL',
      [membership.id],
    )
    if (stream.rows[0]) consequences.push('stop-stream')
    return consequences
  }
  private confirmationRequired(
    membership: CurrentMembership,
    consequences: readonly Consequence[],
  ): ConfirmationRequired {
    return {
      status: 'confirmation-required',
      consequences,
      confirmation: {
        sourceMembershipId: membership.id,
        consequences,
      },
    }
  }

  private async closeRoomIfDue(
    client: PoolClient,
    roomId: string,
    instant: Date,
  ) {
    const room = await this.repository.room(roomId, client, true)
    if (!room || room.endedAt) return true
    const deadline = roomEndDeadline(room)
    if (deadline.getTime() > instant.getTime()) return false
    await endRoom(client, roomId, deadline)
    return true
  }


  private async depart(
    client: PoolClient,
    membership: CurrentMembership,
    instant: Date,
  ): Promise<'active' | 'empty-grace' | 'ended'> {
    const roomResult = await client.query<
      Pick<RoomRecord, 'createdAt' | 'emptyAt' | 'endedAt'>
    >(
      `SELECT created_at AS "createdAt",
              empty_at AS "emptyAt",
              ended_at AS "endedAt"
         FROM room
        WHERE id = $1
        FOR UPDATE`,
      [membership.roomId],
    )
    const room = roomResult.rows[0]
    if (!room || room.endedAt) return 'ended'
    const deadline = roomEndDeadline(room)
    if (deadline.getTime() <= instant.getTime()) {
      await endRoom(client, membership.roomId, deadline)
      return 'ended'
    }
    await client.query(
      `UPDATE stream_subscription
          SET ended_at = $2
        WHERE viewer_membership_id = $1 AND ended_at IS NULL`,
      [membership.id, instant],
    )
    await client.query(
      `UPDATE stream_subscription subscription
          SET ended_at = $2
         FROM stream
        WHERE subscription.stream_id = stream.id
          AND stream.membership_id = $1
          AND subscription.ended_at IS NULL`,
      [membership.id, instant],
    )
    await client.query(
      'UPDATE stream SET ended_at = $2, preview_key = NULL, preview_updated_at = NULL WHERE membership_id = $1 AND ended_at IS NULL',
      [membership.id, instant],
    )
    await client.query(
      'UPDATE room_membership SET left_at = $2 WHERE id = $1 AND left_at IS NULL',
      [membership.id, instant],
    )

    const remaining = await client.query<{ id: string; role: 'host' | 'member' }>(
      `SELECT id, role
         FROM room_membership
        WHERE room_id = $1 AND left_at IS NULL
        ORDER BY joined_at, id
        FOR UPDATE`,
      [membership.roomId],
    )
    if (remaining.rows.length === 0) {
      await client.query('UPDATE room SET empty_at = $2 WHERE id = $1', [
        membership.roomId,
        instant,
      ])
      return 'empty-grace'
    }
    if (membership.role === 'host') {
      await client.query("UPDATE room_membership SET role = 'host' WHERE id = $1", [
        remaining.rows[0].id,
      ])
    }
    return 'active'
  }


  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.configuration.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

function membershipProjection(membership: CurrentMembership): MembershipProjection {
  return {
    id: membership.id,
    roomId: membership.roomId,
    accountId: membership.accountId,
    role: membership.role,
    joinedAt: membership.joinedAt,
  }
}

function roomProjection(room: RoomRecord): RoomProjection {
  return {
    id: room.id,
    name: room.name,
    category: room.category,
    tags: room.tags,
    visibility: room.visibility,
    createdAt: room.createdAt,
    expiresAt: new Date(room.createdAt.getTime() + ROOM_LIFETIME_MS),
  }
}


function roomExpired(room: RoomRecord, instant: Date) {
  return room.createdAt.getTime() + ROOM_LIFETIME_MS <= instant.getTime()
}

function emptyGraceExpired(room: RoomRecord, instant: Date) {
  return (
    room.emptyAt !== null &&
    room.emptyAt.getTime() + EMPTY_GRACE_MS <= instant.getTime()
  )
}

function confirmationMatches(
  confirmation: MembershipConfirmation | undefined,
  membership: CurrentMembership,
  consequences: readonly Consequence[],
) {
  return (
    confirmation?.sourceMembershipId === membership.id &&
    confirmation.consequences.length === consequences.length &&
    confirmation.consequences.every(
      (consequence, index) => consequence === consequences[index],
    )
  )
}

async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = (await deriveKey(password, salt, 32)) as Buffer
  return `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`
}

async function passwordMatches(password: string, stored: string) {
  const [algorithm, encodedSalt, encodedKey] = stored.split(':')
  if (algorithm !== 'scrypt' || !encodedSalt || !encodedKey) return false
  const expected = Buffer.from(encodedKey, 'base64url')
  const actual = (await deriveKey(
    password,
    Buffer.from(encodedSalt, 'base64url'),
    expected.length,
  )) as Buffer
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
