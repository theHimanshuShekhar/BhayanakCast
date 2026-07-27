import type { Pool, PoolClient } from 'pg'
import type { Clock } from '../time'
import { endRoom, ROOM_LIFETIME_MS, roomEndDeadline } from './end-room'
import { selectNextHost } from './host-policy'

export const RECONNECT_GRACE_MS = 45_000

export type TerminalDepartureReason =
  | 'leave'
  | 'kick'
  | 'ban'
  | 'displacement'
  | 'sanction'
  | 'admission-loss'
  | 'room-end'
  | 'expiry'

export interface MembershipSnapshot {
  readonly id: string
  readonly roomId: string
  readonly accountId: string
  readonly role: 'host' | 'member'
  readonly joinedAt: Date
  readonly reconnectUntil: Date | null
}

export type UnexpectedDisconnectResult =
  | {
      readonly status: 'reserved'
      readonly roomId: string
      readonly membership: MembershipSnapshot
      readonly reconnectUntil: Date
    }
  | { readonly status: 'not-member' | 'ended'; readonly roomId?: string }

export type ReclaimResult =
  | {
      readonly status: 'reclaimed'
      readonly roomId: string
      readonly membership: MembershipSnapshot
    }
  | {
      readonly status: 'already-connected'
      readonly roomId: string
      readonly membership: MembershipSnapshot
    }
  | { readonly status: 'not-member' }
  | { readonly status: 'expired'; readonly roomId: string; readonly roomState: 'active' | 'empty-grace' }

export type DepartureResult =
  | { readonly status: 'left'; readonly roomId: string; readonly roomState: 'active' | 'empty-grace' }
  | { readonly status: 'not-member' }
  | { readonly status: 'ended'; readonly roomId: string }

export interface MembershipServiceConfiguration {
  readonly pool: Pool
  readonly now?: () => Date
  readonly clock?: Clock
  readonly scheduleReconnect?: (
    membershipId: string,
    reconnectUntil: Date,
  ) => void
}

interface CurrentMembershipRow {
  id: string
  roomId: string
  accountId: string
  role: 'host' | 'member'
  joinedAt: Date
  reconnectUntil: Date | null
}

interface RoomDeadlineRow {
  createdAt: Date
  emptyAt: Date | null
  endedAt: Date | null
}

export class MembershipService {
  private readonly now: () => Date
  private readonly scheduleReconnect?: MembershipServiceConfiguration['scheduleReconnect']

  constructor(private readonly configuration: MembershipServiceConfiguration) {
    this.now = configuration.now ?? (() => new Date())
    this.scheduleReconnect = configuration.scheduleReconnect
  }

  async unexpectedDisconnect(accountId: string): Promise<UnexpectedDisconnectResult> {
    let scheduled: { membershipId: string; reconnectUntil: Date } | undefined
    const result = await this.transaction(async (client) => {
      if (!(await this.lockAccount(client, accountId))) {
        return { status: 'not-member' as const }
      }
      const observed = await this.currentMembership(client, accountId)
      if (!observed) return { status: 'not-member' as const }
      const room = await this.room(client, observed.roomId, true)
      const membership = await this.currentMembership(client, accountId, true)
      if (!membership || membership.roomId !== observed.roomId) {
        return { status: 'not-member' as const }
      }
      const instant = this.now()
      if (!room || room.endedAt || this.roomIsDue(room, instant)) {
        if (room && !room.endedAt) await endRoom(client, membership.roomId, roomEndDeadline(room))
        return { status: 'ended' as const, roomId: membership.roomId }
      }
      if (membership.reconnectUntil) {
        if (membership.reconnectUntil.getTime() > instant.getTime()) {
          scheduled = { membershipId: membership.id, reconnectUntil: membership.reconnectUntil }
          return {
            status: 'reserved' as const,
            roomId: membership.roomId,
            membership: membershipSnapshot(membership),
            reconnectUntil: membership.reconnectUntil,
          }
        }
        await this.departInTransaction(client, membership, room, instant)
        return { status: 'not-member' as const, roomId: membership.roomId }
      }
      const reconnectUntil = new Date(
        Math.min(
          instant.getTime() + RECONNECT_GRACE_MS,
          room.createdAt.getTime() + ROOM_LIFETIME_MS,
        ),
      )
      await this.stopMembershipMedia(client, membership.id, instant)
      await client.query(
        `UPDATE room_membership
            SET reconnect_until = $2
          WHERE id = $1 AND left_at IS NULL`,
        [membership.id, reconnectUntil],
      )
      scheduled = { membershipId: membership.id, reconnectUntil }
      return {
        status: 'reserved' as const,
        roomId: membership.roomId,
        membership: { ...membershipSnapshot(membership), reconnectUntil },
        reconnectUntil,
      }
    })
    if (scheduled) this.schedule(scheduled.membershipId, scheduled.reconnectUntil)
    return result
  }

  async reclaim(accountId: string): Promise<ReclaimResult> {
    return this.transaction(async (client) => {
      if (!(await this.lockAccount(client, accountId))) {
        return { status: 'not-member' as const }
      }
      const observed = await this.currentMembership(client, accountId)
      if (!observed) return { status: 'not-member' as const }
      const room = await this.room(client, observed.roomId, true)
      const membership = await this.currentMembership(client, accountId, true)
      if (!membership || membership.roomId !== observed.roomId) {
        return { status: 'not-member' as const }
      }
      const instant = this.now()
      if (!room || room.endedAt || this.roomIsDue(room, instant)) {
        if (room && !room.endedAt) await endRoom(client, membership.roomId, roomEndDeadline(room))
        return { status: 'not-member' as const }
      }
      if (!membership.reconnectUntil) {
        return {
          status: 'already-connected' as const,
          roomId: membership.roomId,
          membership: membershipSnapshot(membership),
        }
      }
      if (membership.reconnectUntil.getTime() <= instant.getTime()) {
        const departure = await this.departInTransaction(client, membership, room, instant)
        return {
          status: 'expired' as const,
          roomId: membership.roomId,
          roomState: departure.roomState,
        }
      }
      await client.query(
        `UPDATE room_membership
            SET reconnect_until = NULL
          WHERE id = $1 AND left_at IS NULL
            AND reconnect_until = $2`,
        [membership.id, membership.reconnectUntil],
      )
      return {
        status: 'reclaimed' as const,
        roomId: membership.roomId,
        membership: { ...membershipSnapshot(membership), reconnectUntil: null },
      }
    })
  }

  async depart(
    accountId: string,
    _reason: TerminalDepartureReason,
  ): Promise<DepartureResult> {
    return this.transaction(async (client) => {
      if (!(await this.lockAccount(client, accountId))) {
        return { status: 'not-member' as const }
      }
      const observed = await this.currentMembership(client, accountId)
      if (!observed) return { status: 'not-member' as const }
      const room = await this.room(client, observed.roomId, true)
      const membership = await this.currentMembership(client, accountId, true)
      if (!membership || membership.roomId !== observed.roomId) {
        return { status: 'not-member' as const }
      }
      const instant = this.now()
      if (!room || room.endedAt || this.roomIsDue(room, instant)) {
        if (room && !room.endedAt) await endRoom(client, membership.roomId, roomEndDeadline(room))
        return { status: 'ended' as const, roomId: membership.roomId }
      }
      return {
        ...(await this.departInTransaction(client, membership, room, instant)),
        roomId: membership.roomId,
      }
    })
  }

  async expireReconnect(
    membershipId: string,
    expectedReconnectUntil: Date,
  ): Promise<DepartureResult> {
    let scheduled: { membershipId: string; reconnectUntil: Date } | undefined
    const result = await this.transaction(async (client) => {
      const observedResult = await client.query<CurrentMembershipRow>(
        `SELECT id,
                room_id AS "roomId",
                account_id AS "accountId",
                role,
                joined_at AS "joinedAt",
                reconnect_until AS "reconnectUntil"
           FROM room_membership
          WHERE id = $1 AND left_at IS NULL`,
        [membershipId],
      )
      const observed = observedResult.rows[0]
      if (!observed || !observed.reconnectUntil) return { status: 'not-member' as const }
      if (observed.reconnectUntil.getTime() !== expectedReconnectUntil.getTime()) {
        return { status: 'not-member' as const }
      }
      if (!(await this.lockAccount(client, observed.accountId))) {
        return { status: 'not-member' as const }
      }
      const room = await this.room(client, observed.roomId, true)
      const membershipResult = await client.query<CurrentMembershipRow>(
        `SELECT id,
                room_id AS "roomId",
                account_id AS "accountId",
                role,
                joined_at AS "joinedAt",
                reconnect_until AS "reconnectUntil"
           FROM room_membership
          WHERE id = $1 AND left_at IS NULL
          FOR UPDATE`,
        [membershipId],
      )
      const membership = membershipResult.rows[0]
      if (
        !membership ||
        membership.roomId !== observed.roomId ||
        membership.accountId !== observed.accountId ||
        !membership.reconnectUntil ||
        membership.reconnectUntil.getTime() !== expectedReconnectUntil.getTime()
      ) {
        return { status: 'not-member' as const }
      }
      const instant = this.now()
      if (membership.reconnectUntil.getTime() > instant.getTime()) {
        scheduled = { membershipId: membership.id, reconnectUntil: membership.reconnectUntil }
        return { status: 'not-member' as const }
      }
      if (!room || room.endedAt || this.roomIsDue(room, instant)) {
        if (room && !room.endedAt) await endRoom(client, membership.roomId, roomEndDeadline(room))
        return { status: 'ended' as const, roomId: membership.roomId }
      }
      return {
        ...(await this.departInTransaction(client, membership, room, instant)),
        roomId: membership.roomId,
      }
    })
    if (scheduled) this.schedule(scheduled.membershipId, scheduled.reconnectUntil)
    return result
  }

  private schedule(membershipId: string, reconnectUntil: Date) {
    if (this.scheduleReconnect) {
      this.scheduleReconnect(membershipId, reconnectUntil)
      return
    }
    const clock = this.configuration.clock
    if (!clock) return
    clock.scheduleAt(reconnectUntil.getTime(), () => {
      void this.expireReconnect(membershipId, reconnectUntil)
    })
  }

  private async departInTransaction(
    client: PoolClient,
    membership: CurrentMembershipRow,
    room: RoomDeadlineRow,
    instant: Date,
  ): Promise<{ status: 'left'; roomState: 'active' | 'empty-grace' }> {
    await this.stopMembershipMedia(client, membership.id, instant)
    await client.query(
      `UPDATE room_membership
          SET left_at = $2,
              reconnect_until = NULL
        WHERE id = $1 AND left_at IS NULL`,
      [membership.id, instant],
    )
    const remainingResult = await client.query<HostCandidateRow>(
      `SELECT id, joined_at AS "joinedAt"
         FROM room_membership
        WHERE room_id = $1 AND left_at IS NULL
        ORDER BY joined_at, id
        FOR UPDATE`,
      [membership.roomId],
    )
    if (remainingResult.rows.length === 0) {
      await client.query(
        'UPDATE room SET empty_at = $2 WHERE id = $1 AND ended_at IS NULL',
        [membership.roomId, instant],
      )
      return { status: 'left', roomState: 'empty-grace' }
    }
    if (membership.role === 'host') {
      const nextHostId = selectNextHost(remainingResult.rows)
      if (nextHostId) {
        await client.query(
          `UPDATE room_membership
              SET role = CASE WHEN id = $2 THEN 'host' ELSE 'member' END
            WHERE room_id = $1 AND left_at IS NULL`,
          [membership.roomId, nextHostId],
        )
      }
    }
    return { status: 'left', roomState: 'active' }
  }

  private async stopMembershipMedia(
    client: PoolClient,
    membershipId: string,
    instant: Date,
  ) {
    await client.query(
      `UPDATE stream_subscription
          SET ended_at = $2
        WHERE viewer_membership_id = $1 AND ended_at IS NULL`,
      [membershipId, instant],
    )
    await client.query(
      `UPDATE stream_subscription subscription
          SET ended_at = $2
         FROM stream
        WHERE subscription.stream_id = stream.id
          AND stream.membership_id = $1
          AND subscription.ended_at IS NULL`,
      [membershipId, instant],
    )
    await client.query(
      `UPDATE stream
          SET ended_at = $2,
              preview_key = NULL,
              preview_updated_at = NULL
        WHERE membership_id = $1 AND ended_at IS NULL`,
      [membershipId, instant],
    )
  }

  private async lockAccount(client: PoolClient, accountId: string) {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM "user" WHERE id = $1 FOR UPDATE',
      [accountId],
    )
    return Boolean(result.rows[0])
  }

  private async currentMembership(
    client: PoolClient,
    accountId: string,
    forUpdate = false,
  ) {
    const result = await client.query<CurrentMembershipRow>(
      `SELECT id,
              room_id AS "roomId",
              account_id AS "accountId",
              role,
              joined_at AS "joinedAt",
              reconnect_until AS "reconnectUntil"
         FROM room_membership
        WHERE account_id = $1 AND left_at IS NULL
        ${forUpdate ? 'FOR UPDATE' : ''}`,
      [accountId],
    )
    return result.rows[0] ?? null
  }

  private async room(client: PoolClient, roomId: string, forUpdate = false) {
    const result = await client.query<RoomDeadlineRow>(
      `SELECT created_at AS "createdAt",
              empty_at AS "emptyAt",
              ended_at AS "endedAt"
         FROM room
        WHERE id = $1
        ${forUpdate ? 'FOR UPDATE' : ''}`,
      [roomId],
    )
    return result.rows[0] ?? null
  }

  private roomIsDue(room: RoomDeadlineRow, instant: Date) {
    const deadline = roomEndDeadline(room)
    return deadline.getTime() <= instant.getTime()
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

interface HostCandidateRow {
  readonly id: string
  readonly joinedAt: Date
}

function membershipSnapshot(membership: CurrentMembershipRow): MembershipSnapshot {
  return {
    id: membership.id,
    roomId: membership.roomId,
    accountId: membership.accountId,
    role: membership.role,
    joinedAt: membership.joinedAt,
    reconnectUntil: membership.reconnectUntil,
  }
}
