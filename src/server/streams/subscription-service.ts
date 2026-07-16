import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { endRoom, roomEndDeadline } from '../rooms/end-room'


export type SubscriptionResult =
  | {
      readonly status: 'subscribed'
      readonly id: string
      readonly streamId: string
    }
  | { readonly status: 'viewer-not-admitted' }
  | { readonly status: 'stream-unavailable' }
  | { readonly status: 'own-stream' }

export interface ActiveSubscription {
  readonly id: string
  readonly streamId: string
  readonly startedAt: Date
}

export class SubscriptionService {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async subscribe(
    viewerMembershipId: string,
    streamId: string,
  ): Promise<SubscriptionResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const observedViewer = await client.query<{ roomId: string }>(
        'SELECT room_id AS "roomId" FROM room_membership WHERE id = $1',
        [viewerMembershipId],
      )
      if (!observedViewer.rows[0]) {
        await client.query('ROLLBACK')
        return { status: 'viewer-not-admitted' }
      }
      const observedTarget = await client.query<{
        roomId: string
        membershipId: string
      }>(
        `SELECT room_id AS "roomId", membership_id AS "membershipId"
           FROM stream
          WHERE id = $1`,
        [streamId],
      )
      if (
        !observedTarget.rows[0] ||
        observedTarget.rows[0].roomId !== observedViewer.rows[0].roomId
      ) {
        await client.query('ROLLBACK')
        return { status: 'stream-unavailable' }
      }

      const room = await client.query<{
        createdAt: Date
        emptyAt: Date | null
        endedAt: Date | null
      }>(
        `SELECT created_at AS "createdAt",
                empty_at AS "emptyAt",
                ended_at AS "endedAt"
           FROM room
          WHERE id = $1
          FOR UPDATE`,
        [observedViewer.rows[0].roomId],
      )
      const instant = this.now()
      const lockedRoom = room.rows[0]
      if (!lockedRoom || lockedRoom.endedAt) {
        await client.query('ROLLBACK')
        return { status: 'stream-unavailable' }
      }
      const deadline = roomEndDeadline(lockedRoom)
      if (deadline.getTime() <= instant.getTime()) {
        await endRoom(client, observedViewer.rows[0].roomId, deadline)
        await client.query('COMMIT')
        return { status: 'stream-unavailable' }
      }

      const viewer = await client.query<{ roomId: string }>(
        `SELECT room_id AS "roomId"
           FROM room_membership
          WHERE id = $1 AND left_at IS NULL
          FOR UPDATE`,
        [viewerMembershipId],
      )
      if (!viewer.rows[0]) {
        await client.query('ROLLBACK')
        return { status: 'viewer-not-admitted' }
      }
      const target = await client.query<{
        roomId: string
        membershipId: string
      }>(
        `SELECT stream.room_id AS "roomId",
                stream.membership_id AS "membershipId"
           FROM stream
           JOIN room_membership publisher
             ON publisher.id = stream.membership_id
            AND publisher.room_id = stream.room_id
          WHERE stream.id = $1
            AND stream.ended_at IS NULL
            AND publisher.left_at IS NULL
          FOR UPDATE OF stream, publisher`,
        [streamId],
      )
      const lockedStream = target.rows[0]
      if (!lockedStream || lockedStream.roomId !== viewer.rows[0].roomId) {
        await client.query('ROLLBACK')
        return { status: 'stream-unavailable' }
      }
      if (lockedStream.membershipId === viewerMembershipId) {
        await client.query('ROLLBACK')
        return { status: 'own-stream' }
      }

      const existing = await client.query<{ id: string }>(
        `SELECT id
           FROM stream_subscription
          WHERE viewer_membership_id = $1 AND ended_at IS NULL
          FOR UPDATE`,
        [viewerMembershipId],
      )
      if (existing.rows[0]) {
        const same = await client.query<{ streamId: string }>(
          `SELECT stream_id AS "streamId"
             FROM stream_subscription
            WHERE id = $1`,
          [existing.rows[0].id],
        )
        if (same.rows[0]?.streamId === streamId) {
          await client.query('COMMIT')
          return { status: 'subscribed', id: existing.rows[0].id, streamId }
        }
      }

      await client.query(
        `UPDATE stream_subscription
            SET ended_at = $2
          WHERE viewer_membership_id = $1 AND ended_at IS NULL`,
        [viewerMembershipId, instant],
      )
      const id = randomUUID()
      await client.query(
        `INSERT INTO stream_subscription
           (id, viewer_membership_id, stream_id, started_at)
         VALUES ($1, $2, $3, $4)`,
        [id, viewerMembershipId, streamId, instant],
      )
      await client.query('COMMIT')
      return { status: 'subscribed', id, streamId }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async current(viewerMembershipId: string): Promise<ActiveSubscription | null> {
    const result = await this.pool.query<ActiveSubscription>(
      `SELECT id, stream_id AS "streamId", started_at AS "startedAt"
         FROM stream_subscription
        WHERE viewer_membership_id = $1 AND ended_at IS NULL`,
      [viewerMembershipId],
    )
    return result.rows[0] ?? null
  }
}
