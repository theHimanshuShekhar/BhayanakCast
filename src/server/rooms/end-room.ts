import type { PoolClient } from 'pg'

export const EMPTY_GRACE_MS = 5 * 60 * 1_000
export const ROOM_LIFETIME_MS = 12 * 60 * 60 * 1_000

export interface RoomDeadline {
  readonly createdAt: Date
  readonly emptyAt: Date | null
}

export function roomEndDeadline(room: RoomDeadline) {
  const lifetimeDeadline = room.createdAt.getTime() + ROOM_LIFETIME_MS
  const emptyDeadline = room.emptyAt
    ? room.emptyAt.getTime() + EMPTY_GRACE_MS
    : Number.POSITIVE_INFINITY
  return new Date(Math.min(lifetimeDeadline, emptyDeadline))
}

export async function endRoom(
  client: PoolClient,
  roomId: string,
  instant: Date,
) {
  await client.query(
    `UPDATE stream_subscription subscription
        SET ended_at = $2
       FROM room_membership viewer
      WHERE subscription.viewer_membership_id = viewer.id
        AND viewer.room_id = $1
        AND subscription.ended_at IS NULL`,
    [roomId, instant],
  )
  await client.query(
    `UPDATE stream_subscription subscription
        SET ended_at = $2
       FROM stream
      WHERE subscription.stream_id = stream.id
        AND stream.room_id = $1
        AND subscription.ended_at IS NULL`,
    [roomId, instant],
  )
  await client.query(
    'UPDATE stream SET ended_at = $2, preview_key = NULL, preview_updated_at = NULL WHERE room_id = $1 AND ended_at IS NULL',
    [roomId, instant],
  )
  await client.query(
    'UPDATE room_membership SET left_at = $2 WHERE room_id = $1 AND left_at IS NULL',
    [roomId, instant],
  )
  await client.query(
    'UPDATE room_ban SET cleared_at = $2 WHERE room_id = $1 AND cleared_at IS NULL',
    [roomId, instant],
  )
  await client.query(
    'UPDATE room SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL',
    [roomId, instant],
  )
}
