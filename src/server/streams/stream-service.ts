import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  AccountAccessDeniedError,
  readAccountAccessPolicy,
  requireAccountMutation,
} from '../auth/account-access-policy'
import { endRoom, roomEndDeadline } from '../rooms/end-room'
import type { RoomEventPublisher } from '../realtime/room-events'

/** Publishing one's own screen. Separate from `stream-subscribe` so the
    `streaming` sanction can stop a member publishing while still letting them
    watch — ADR 0101 keeps those two capabilities distinct. */
const PUBLISH_MUTATION = 'stream-subscribe' as const

export type StartStreamResult =
  | {
      readonly status: 'started'
      readonly streamId: string
      readonly roomId: string
      readonly membershipId: string
    }
  | { readonly status: 'already-streaming'; readonly streamId: string }
  | { readonly status: 'not-admitted' }
  | { readonly status: 'room-ended' }
  | { readonly status: 'account-read-only' | 'all-access-sanctioned' }

export type StopStreamResult =
  | {
      readonly status: 'stopped'
      readonly streamId: string
      readonly roomId: string
      readonly membershipId: string
      /** Subscriptions closed by this stop. ADR 0104: conforming clients must
          close the matching `RTCPeerConnection` immediately. */
      readonly endedSubscriptionIds: readonly string[]
    }
  | { readonly status: 'not-streaming' }
  | { readonly status: 'not-admitted' }
  | { readonly status: 'not-authorized' }

export type HostStopStreamResult =
  | {
      readonly status: 'stopped'
      readonly streamId: string
      readonly roomId: string
      readonly membershipId: string
      readonly targetAccountId: string
      readonly targetDisplayName: string
      readonly endedSubscriptionIds: readonly string[]
    }
  | { readonly status: 'not-streaming' | 'not-member' | 'not-authorized' }

export interface StreamModerationAuditEntry {
  readonly level: 'info'
  readonly event: 'room.stream_stopped_by_host'
  readonly roomId: string
  readonly streamId: string
  readonly actorAccountId: string
  readonly targetAccountId: string
  readonly outcome: HostStopStreamResult['status']
  readonly occurredAt: string
}

export interface StreamServiceConfiguration {
  readonly pool: Pool
  readonly now?: () => Date
  /** Invoked after a committed change so the room and Home projections can
      recompute their Stream counts. Failures here never fail the mutation. */
  readonly onRoomChanged?: (roomId: string) => void | Promise<void>
  readonly publishRoomEvent?: RoomEventPublisher
  /** Host/subject detail is private operational evidence and is isolated from
      the already committed Stream mutation if the sink fails. */
  readonly moderationAudit?: (entry: StreamModerationAuditEntry) => void
}

export class StreamService {
  private readonly pool: Pool
  private readonly now: () => Date
  private readonly onRoomChanged: (roomId: string) => void | Promise<void>
  private readonly publishRoomEvent: RoomEventPublisher
  private readonly moderationAudit: (entry: StreamModerationAuditEntry) => void

  constructor(configuration: StreamServiceConfiguration) {
    this.pool = configuration.pool
    this.now = configuration.now ?? (() => new Date())
    this.onRoomChanged = configuration.onRoomChanged ?? (() => {})
    this.publishRoomEvent = configuration.publishRoomEvent ?? (() => {})
    this.moderationAudit = configuration.moderationAudit ?? writeStreamModerationAudit
  }

  async start(accountId: string, roomId: string): Promise<StartStreamResult> {
    const result = await this.transact<StartStreamResult>(async (client) => {
      const access = await this.assertMutable(client, accountId)
      if (access) return access

      const membership = await currentMembership(client, accountId)
      if (!membership || membership.roomId !== roomId) return { status: 'not-admitted' }

      const live = await this.assertLiveRoom(client, roomId)
      if (live) return live

      const existing = await client.query<{ id: string }>(
        `SELECT id FROM stream
          WHERE membership_id = $1 AND ended_at IS NULL
          FOR UPDATE`,
        [membership.id],
      )
      if (existing.rows[0]) {
        return { status: 'already-streaming', streamId: existing.rows[0].id }
      }

      const streamId = randomUUID()
      await client.query(
        `INSERT INTO stream (id, room_id, membership_id, started_at)
         VALUES ($1, $2, $3, $4)`,
        [streamId, roomId, membership.id, this.now()],
      )
      return { status: 'started', streamId, roomId, membershipId: membership.id }
    })
    if (result.status === 'started') {
      this.emitRoomEvent({
        type: 'stream-started',
        roomId: result.roomId,
        streamId: result.streamId,
        membershipId: result.membershipId,
      })
      await this.notify(result.roomId)
    }
    return result
  }

  /** Owner stop is intentionally owner-only. Host moderation uses
      `stopByHost` so subject attribution and private audit cannot be bypassed. */
  async stop(
    accountId: string,
    options: { readonly streamId?: string } = {},
  ): Promise<StopStreamResult> {
    const result = await this.transact<StopStreamResult>(async (client) => {
      const membership = await currentMembership(client, accountId)
      if (!membership) return { status: 'not-admitted' }

      const target = await client.query<{
        id: string
        roomId: string
        membershipId: string
      }>(
        options.streamId
          ? `SELECT id, room_id AS "roomId", membership_id AS "membershipId"
               FROM stream
              WHERE id = $1 AND ended_at IS NULL
              FOR UPDATE`
          : `SELECT id, room_id AS "roomId", membership_id AS "membershipId"
               FROM stream
              WHERE membership_id = $1 AND ended_at IS NULL
              FOR UPDATE`,
        [options.streamId ?? membership.id],
      )
      const stream = target.rows[0]
      if (!stream) return { status: 'not-streaming' }
      if (stream.roomId !== membership.roomId) return { status: 'not-authorized' }
      if (stream.membershipId !== membership.id) return { status: 'not-authorized' }

      const instant = this.now()
      const closed = await client.query<{ id: string }>(
        `UPDATE stream_subscription
            SET ended_at = $2
          WHERE stream_id = $1 AND ended_at IS NULL
      RETURNING id`,
        [stream.id, instant],
      )
      await client.query(`UPDATE stream SET ended_at = $2 WHERE id = $1`, [
        stream.id,
        instant,
      ])
      return {
        status: 'stopped',
        streamId: stream.id,
        roomId: stream.roomId,
        membershipId: stream.membershipId,
        endedSubscriptionIds: closed.rows.map((row) => row.id),
      }
    })
    if (result.status === 'stopped') {
      this.emitRoomEvent({
        type: 'stream-stopped',
        roomId: result.roomId,
        streamId: result.streamId,
        membershipId: result.membershipId,
      })
      await this.notify(result.roomId)
    }
    return result
  }
  /** Stops exactly the selected member's current Stream while preserving their
      Room Membership. Actor and subject stay distinct for Activity/audit
      attribution, and a stale selection cannot stop a replacement Stream. */
  async stopByHost(
    actorAccountId: string,
    input: {
      readonly roomId: string
      readonly targetAccountId: string
      readonly streamId: string
    },
  ): Promise<HostStopStreamResult> {
    const result = await this.transact<HostStopStreamResult>(async (client) => {
      const accounts = await client.query<{ id: string }>(
        `SELECT id FROM "user"
          WHERE id IN ($1, $2)
          ORDER BY id
          FOR UPDATE`,
        [actorAccountId, input.targetAccountId],
      )
      if (
        actorAccountId === input.targetAccountId ||
        !accounts.rows.some((account) => account.id === actorAccountId)
      ) {
        return { status: 'not-authorized' }
      }
      const access = await readAccountAccessPolicy(client, actorAccountId, this.now())
      if (!access?.canMutate('moderate')) return { status: 'not-authorized' }

      const room = await client.query<{ id: string }>(
        `SELECT id FROM room
          WHERE id = $1 AND ended_at IS NULL
          FOR UPDATE`,
        [input.roomId],
      )
      if (!room.rows[0]) return { status: 'not-authorized' }

      const actor = await currentMembership(client, actorAccountId)
      if (!actor || actor.roomId !== input.roomId || actor.role !== 'host') {
        return { status: 'not-authorized' }
      }
      const target = await client.query<{
        id: string
        displayName: string
      }>(
        `SELECT membership.id, account.name AS "displayName"
           FROM room_membership membership
           JOIN "user" account ON account.id = membership.account_id
          WHERE membership.account_id = $1
            AND membership.room_id = $2
            AND membership.left_at IS NULL
          FOR UPDATE OF membership`,
        [input.targetAccountId, input.roomId],
      )
      const targetMembership = target.rows[0]
      if (!targetMembership) return { status: 'not-member' }

      const selected = await client.query<{
        id: string
        roomId: string
        membershipId: string
      }>(
        `SELECT id, room_id AS "roomId", membership_id AS "membershipId"
           FROM stream
          WHERE id = $1
            AND room_id = $2
            AND membership_id = $3
            AND ended_at IS NULL
          FOR UPDATE`,
        [input.streamId, input.roomId, targetMembership.id],
      )
      const stream = selected.rows[0]
      if (!stream) return { status: 'not-streaming' }

      const instant = this.now()
      const closed = await client.query<{ id: string }>(
        `UPDATE stream_subscription
            SET ended_at = $2
          WHERE stream_id = $1 AND ended_at IS NULL
      RETURNING id`,
        [stream.id, instant],
      )
      await client.query(`UPDATE stream SET ended_at = $2 WHERE id = $1`, [
        stream.id,
        instant,
      ])
      return {
        status: 'stopped',
        streamId: stream.id,
        roomId: stream.roomId,
        membershipId: stream.membershipId,
        targetAccountId: input.targetAccountId,
        targetDisplayName: targetMembership.displayName,
        endedSubscriptionIds: closed.rows.map((subscription) => subscription.id),
      }
    })
    this.emitHostStopAudit(actorAccountId, input, result.status)
    if (result.status === 'stopped') {
      this.emitRoomEvent({
        type: 'stream-stopped',
        roomId: result.roomId,
        streamId: result.streamId,
        membershipId: result.membershipId,
      })
      await this.notify(result.roomId)
    }
    return result
  }


  /** Ends every Stream a membership owns. Used when a member leaves, is
      displaced, or loses admission — ADR 0103 requires their Stream to stay
      stopped and need an explicit restart. */
  async stopForMembership(membershipId: string): Promise<readonly string[]> {
    const instant = this.now()
    const result = await this.transact(async (client) => {
      const streams = await client.query<{ id: string; roomId: string }>(
        `SELECT id, room_id AS "roomId" FROM stream
          WHERE membership_id = $1 AND ended_at IS NULL
          FOR UPDATE`,
        [membershipId],
      )
      if (streams.rows.length === 0) return { roomIds: [], streamIds: [] }
      await client.query(
        `UPDATE stream_subscription
            SET ended_at = $2
          WHERE ended_at IS NULL
            AND stream_id IN (SELECT id FROM stream WHERE membership_id = $1 AND ended_at IS NULL)`,
        [membershipId, instant],
      )
      await client.query(
        `UPDATE stream SET ended_at = $2 WHERE membership_id = $1 AND ended_at IS NULL`,
        [membershipId, instant],
      )
      return {
        roomIds: [...new Set(streams.rows.map((row) => row.roomId))],
        streamIds: streams.rows.map((row) => row.id),
      }
    })
    for (const roomId of result.roomIds) await this.notify(roomId)
    return result.streamIds
  }

  private async assertMutable(
    client: PoolClient,
    accountId: string,
  ): Promise<{ readonly status: 'account-read-only' | 'all-access-sanctioned' } | null> {
    await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [accountId])
    try {
      const access = await requireAccountMutation(
        client,
        accountId,
        PUBLISH_MUTATION,
        this.now(),
      )
      if (access.canMutate(PUBLISH_MUTATION)) return null
      return {
        status:
          access.state === 'sanctioned' ? 'all-access-sanctioned' : 'account-read-only',
      }
    } catch (error) {
      if (!(error instanceof AccountAccessDeniedError)) throw error
      return {
        status:
          error.state === 'sanctioned' ? 'all-access-sanctioned' : 'account-read-only',
      }
    }
  }

  /** Publishing into a room that has already outlived its lifetime would leave
      media attached to a dead room, so the overdue room is ended here first —
      the same treatment `SubscriptionService` gives a watch. */
  private async assertLiveRoom(
    client: PoolClient,
    roomId: string,
  ): Promise<{ readonly status: 'room-ended' } | null> {
    const room = await client.query<{
      createdAt: Date
      emptyAt: Date | null
      endedAt: Date | null
    }>(
      `SELECT created_at AS "createdAt", empty_at AS "emptyAt", ended_at AS "endedAt"
         FROM room WHERE id = $1 FOR UPDATE`,
      [roomId],
    )
    const locked = room.rows[0]
    if (!locked || locked.endedAt) return { status: 'room-ended' }
    const deadline = roomEndDeadline(locked)
    if (deadline.getTime() <= this.now().getTime()) {
      await endRoom(client, roomId, deadline)
      return { status: 'room-ended' }
    }
    return null
  }

  private emitHostStopAudit(
    actorAccountId: string,
    input: {
      readonly roomId: string
      readonly targetAccountId: string
      readonly streamId: string
    },
    outcome: HostStopStreamResult['status'],
  ) {
    try {
      this.moderationAudit({
        level: 'info',
        event: 'room.stream_stopped_by_host',
        roomId: input.roomId,
        streamId: input.streamId,
        actorAccountId,
        targetAccountId: input.targetAccountId,
        outcome,
        occurredAt: this.now().toISOString(),
      })
    } catch {
      // Audit delivery cannot change the already decided moderation result.
    }
  }

  private emitRoomEvent(event: Parameters<RoomEventPublisher>[0]) {
    try {
      this.publishRoomEvent(event)
    } catch {
      // Realtime delivery cannot change the already committed Stream result.
    }
  }

  private async notify(roomId: string) {
    try {
      await this.onRoomChanged(roomId)
    } catch {
      // Projection fan-out is best effort once the stream change has committed.
    }
  }

  private async transact<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(client)
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

async function currentMembership(client: PoolClient, accountId: string) {
  const result = await client.query<{
    id: string
    roomId: string
    role: 'host' | 'member'
  }>(
    `SELECT id, room_id AS "roomId", role
       FROM room_membership
      WHERE account_id = $1 AND left_at IS NULL
      FOR UPDATE`,
    [accountId],
  )
  return result.rows[0] ?? null
}

function writeStreamModerationAudit(entry: StreamModerationAuditEntry) {
  console.info(JSON.stringify(entry))
}
