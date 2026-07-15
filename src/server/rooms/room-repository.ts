import type { Pool, PoolClient } from 'pg'

export type QueryExecutor = Pick<Pool | PoolClient, 'query'>
export type MembershipRole = 'host' | 'member'

export interface CurrentMembership {
  readonly id: string
  readonly roomId: string
  readonly accountId: string
  readonly role: MembershipRole
  readonly joinedAt: Date
}

export interface RoomRecord {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly tags: string[]
  readonly visibility: 'public' | 'private'
  readonly passwordHash: string | null
  readonly createdAt: Date
  readonly emptyAt: Date | null
  readonly endedAt: Date | null
}

export class RoomRepository {
  constructor(private readonly pool: Pool) {}

  async currentMembership(
    accountId: string,
    executor: QueryExecutor = this.pool,
    forUpdate = false,
  ): Promise<CurrentMembership | null> {
    const result = await executor.query<CurrentMembership>(
      `SELECT id,
              room_id AS "roomId",
              account_id AS "accountId",
              role,
              joined_at AS "joinedAt"
         FROM room_membership
        WHERE account_id = $1 AND left_at IS NULL
        ${forUpdate ? 'FOR UPDATE' : ''}`,
      [accountId],
    )
    return result.rows[0] ?? null
  }

  async room(
    roomId: string,
    executor: QueryExecutor = this.pool,
    forUpdate = false,
  ): Promise<RoomRecord | null> {
    const result = await executor.query<RoomRecord>(
      `SELECT id, name, category, tags, visibility,
              password_hash AS "passwordHash",
              created_at AS "createdAt",
              empty_at AS "emptyAt",
              ended_at AS "endedAt"
         FROM room
        WHERE id = $1
        ${forUpdate ? 'FOR UPDATE' : ''}`,
      [roomId],
    )
    return result.rows[0] ?? null
  }

  async memberCount(roomId: string, executor: QueryExecutor = this.pool) {
    const result = await executor.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM room_membership
        WHERE room_id = $1 AND left_at IS NULL`,
      [roomId],
    )
    return result.rows[0]?.count ?? 0
  }
}
