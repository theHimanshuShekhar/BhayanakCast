import type { Pool, PoolClient } from 'pg'
import { endRoom, EMPTY_GRACE_MS, ROOM_LIFETIME_MS } from './end-room'
import type { Clock, ScheduledTask } from '../time'

const WARNING_MINUTES = [30, 10, 1] as const
const WARNING_COLUMNS: Record<(typeof WARNING_MINUTES)[number], string> = {
  30: 'warning_30_sent_at',
  10: 'warning_10_sent_at',
  1: 'warning_1_sent_at',
}
const CALLBACK_RETRY_MS = 1_000

export interface RoomLifecycleWarning {
  readonly roomId: string
  readonly minutes: (typeof WARNING_MINUTES)[number]
}
export interface RoomLifecycleConfiguration {
  readonly pool: Pool
  readonly clock: Clock
  readonly onWarning?: (warning: RoomLifecycleWarning) => Promise<unknown> | unknown
  readonly onRoomEnded?: (roomId: string) => Promise<unknown> | unknown
  readonly onReconnectExpired?: (
    membershipId: string,
    reconnectUntil: Date,
  ) => Promise<unknown> | unknown
  readonly onError?: (error: unknown) => void
}

interface RoomRow {
  readonly id: string
  readonly createdAt: Date
  readonly emptyAt: Date | null
  readonly endedAt: Date | null
}

export class RoomLifecycle {
  private readonly roomTasks = new Map<string, ScheduledTask[]>()
  private readonly roomGenerations = new Map<string, number>()
  private readonly membershipTasks = new Map<string, ScheduledTask>()
  private readonly pendingTasks = new Set<Promise<unknown>>()
  private readonly deliveredRoomEnds = new Set<string>()

  async drain(): Promise<void> {
    while (this.pendingTasks.size > 0) {
      await Promise.all([...this.pendingTasks])
    }
  }

  constructor(private readonly configuration: RoomLifecycleConfiguration) {}

  async recover(): Promise<void> {
    const [rooms, memberships] = await Promise.all([
      this.configuration.pool.query<RoomRow>(
        `SELECT id,
                created_at AS "createdAt",
                empty_at AS "emptyAt",
                ended_at AS "endedAt"
           FROM room
          WHERE ended_at IS NULL`,
      ),
      this.configuration.pool.query<{
        id: string
        reconnectUntil: Date
      }>(
        `SELECT id, reconnect_until AS "reconnectUntil"
           FROM room_membership
          WHERE left_at IS NULL
            AND reconnect_until IS NOT NULL`,
      ),
    ])
    await Promise.all(
      rooms.rows.map(async (room) => {
        await this.reconcileMissedWarnings(room)
        await this.scheduleRoom(room.id)
      }),
    )
    for (const membership of memberships.rows) {
      this.scheduleMembership(membership.id, membership.reconnectUntil)
    }
  }

  async scheduleRoom(roomId: string): Promise<void> {
    const generation = (this.roomGenerations.get(roomId) ?? 0) + 1
    this.roomGenerations.set(roomId, generation)
    this.cancelRoomTasks(roomId)
    try {
      const result = await this.configuration.pool.query<RoomRow>(
        `SELECT id,
                created_at AS "createdAt",
                empty_at AS "emptyAt",
                ended_at AS "endedAt"
           FROM room
          WHERE id = $1`,
        [roomId],
      )
      if (generation !== this.roomGenerations.get(roomId)) return
      const room = result.rows[0]
      if (!room || room.endedAt) return
      this.scheduleRoomRow(room)
    } catch (error) {
      if (generation !== this.roomGenerations.get(roomId)) return
      this.report(error)
      this.scheduleRoomRefreshRetry(roomId, generation)
    }
  }

  private scheduleRoomRefreshRetry(roomId: string, generation: number): void {
    const task = this.configuration.clock.scheduleAt(
      this.configuration.clock.now() + CALLBACK_RETRY_MS,
      () => {
        if (generation !== this.roomGenerations.get(roomId)) return
        this.track(this.scheduleRoom(roomId), () => {
          const currentGeneration = this.roomGenerations.get(roomId)
          if (currentGeneration !== undefined) {
            this.scheduleRoomRefreshRetry(roomId, currentGeneration)
          }
        })
      },
    )
    this.roomTasks.set(roomId, [task])
  }

  scheduleMembership(membershipId: string, reconnectUntil: Date): void {
    this.membershipTasks.get(membershipId)?.cancel()
    this.membershipTasks.set(
      membershipId,
      this.configuration.clock.scheduleAt(reconnectUntil.getTime(), () => {
        this.track(
          this.expireMembership(membershipId, reconnectUntil),
          () => this.scheduleMembershipRetry(membershipId, reconnectUntil),
        )
      }),
    )
  }

  private scheduleRoomRow(room: RoomRow): void {
    if (room.endedAt) return
    const lifetimeDeadline = room.createdAt.getTime() + ROOM_LIFETIME_MS
    const now = this.configuration.clock.now()
    const tasks: ScheduledTask[] = []
    for (const minutes of WARNING_MINUTES) {
      const deadline = lifetimeDeadline - minutes * 60_000
      if (deadline >= now) {
        tasks.push(
          this.configuration.clock.scheduleAt(deadline, () => {
            this.track(
              this.emitWarning(room.id, minutes, deadline),
              () => this.scheduleWarningRetry(room.id, minutes, deadline),
            )
          }),
        )
      }
    }
    tasks.push(
      this.configuration.clock.scheduleAt(
        Math.max(now, lifetimeDeadline),
        () => {
          this.track(
            this.processRoomDeadline(room.id),
            () => this.scheduleRoomRetry(room.id),
          )
        },
      ),
    )
    if (room.emptyAt) {
      const emptyDeadline = room.emptyAt.getTime() + EMPTY_GRACE_MS
      tasks.push(
        this.configuration.clock.scheduleAt(
          Math.max(now, emptyDeadline),
          () => {
            this.track(
              this.processRoomDeadline(room.id),
              () => this.scheduleRoomRetry(room.id),
            )
          },
        ),
      )
    }
    this.roomTasks.set(room.id, tasks)
  }

  private cancelRoomTasks(roomId: string) {
    for (const task of this.roomTasks.get(roomId) ?? []) task.cancel()
    this.roomTasks.delete(roomId)
  }

  private async emitWarning(
    roomId: string,
    minutes: (typeof WARNING_MINUTES)[number],
    expectedDeadline: number,
  ): Promise<void> {
    const sentAt = await this.transaction(async (client) => {
      const result = await client.query<RoomRow>(
        `SELECT id,
                created_at AS "createdAt",
                empty_at AS "emptyAt",
                ended_at AS "endedAt",
                warning_30_sent_at,
                warning_10_sent_at,
                warning_1_sent_at
           FROM room
          WHERE id = $1
          FOR UPDATE`,
        [roomId],
      )
      const room = result.rows[0]
      if (!room || room.endedAt) return null
      const deadline = room.createdAt.getTime() + ROOM_LIFETIME_MS - minutes * 60_000
      if (deadline !== expectedDeadline || this.configuration.clock.now() < deadline) {
        return null
      }
      if (this.configuration.clock.now() >= room.createdAt.getTime() + ROOM_LIFETIME_MS) {
        return null
      }
      const column = WARNING_COLUMNS[minutes]
      const sent = new Date(this.configuration.clock.now())
      const update = await client.query(
        `UPDATE room
            SET ${column} = $2
          WHERE id = $1 AND ended_at IS NULL AND ${column} IS NULL
          RETURNING id`,
        [roomId, sent],
      )
      return update.rows[0] ? { column, sent } : null
    })
    if (!sentAt) return
    try {
      await this.configuration.onWarning?.({ roomId, minutes })
    } catch (error) {
      await this.resetWarning(roomId, sentAt.column, sentAt.sent)
      throw error
    }
  }

  private async processRoomDeadline(roomId: string): Promise<void> {
    if (this.deliveredRoomEnds.has(roomId)) return
    const due = await this.transaction(async (client) => {
      const result = await client.query<RoomRow>(
        `SELECT id,
                created_at AS "createdAt",
                empty_at AS "emptyAt",
                ended_at AS "endedAt"
           FROM room
          WHERE id = $1
          FOR UPDATE`,
        [roomId],
      )
      const room = result.rows[0]
      if (!room) return false
      if (room.endedAt) return true
      const lifetimeDeadline = room.createdAt.getTime() + ROOM_LIFETIME_MS
      const emptyDeadline = room.emptyAt
        ? room.emptyAt.getTime() + EMPTY_GRACE_MS
        : Number.POSITIVE_INFINITY
      const deadline = Math.min(lifetimeDeadline, emptyDeadline)
      if (deadline > this.configuration.clock.now()) return false
      await endRoom(client, roomId, new Date(deadline))
      return true
    })
    if (!due) return
    await this.configuration.onRoomEnded?.(roomId)
    this.deliveredRoomEnds.add(roomId)
  }

  private async expireMembership(
    membershipId: string,
    reconnectUntil: Date,
  ): Promise<void> {
    this.membershipTasks.delete(membershipId)
    await this.configuration.onReconnectExpired?.(membershipId, reconnectUntil)
  }

  private track(task: Promise<unknown>, retry: () => void): void {
    this.pendingTasks.add(task)
    void task.then(
      () => this.pendingTasks.delete(task),
      (error) => {
        this.pendingTasks.delete(task)
        this.report(error)
        retry()
      },
    )
  }

  private scheduleRoomRetry(roomId: string): void {
    const task = this.configuration.clock.scheduleAt(
      this.configuration.clock.now() + CALLBACK_RETRY_MS,
      () => {
        this.track(this.processRoomDeadline(roomId), () => this.scheduleRoomRetry(roomId))
      },
    )
    this.roomTasks.set(roomId, [...(this.roomTasks.get(roomId) ?? []), task])
  }

  private scheduleWarningRetry(
    roomId: string,
    minutes: (typeof WARNING_MINUTES)[number],
    expectedDeadline: number,
  ): void {
    const task = this.configuration.clock.scheduleAt(
      this.configuration.clock.now() + CALLBACK_RETRY_MS,
      () => {
        this.track(
          this.emitWarning(roomId, minutes, expectedDeadline),
          () => this.scheduleWarningRetry(roomId, minutes, expectedDeadline),
        )
      },
    )
    this.roomTasks.set(roomId, [...(this.roomTasks.get(roomId) ?? []), task])
  }

  private scheduleMembershipRetry(
    membershipId: string,
    reconnectUntil: Date,
  ): void {
    const task = this.configuration.clock.scheduleAt(
      this.configuration.clock.now() + CALLBACK_RETRY_MS,
      () => {
        this.track(
          this.expireMembership(membershipId, reconnectUntil),
          () => this.scheduleMembershipRetry(membershipId, reconnectUntil),
        )
      },
    )
    this.membershipTasks.set(membershipId, task)
  }

  private async resetWarning(
    roomId: string,
    column: string,
    sentAt: Date,
  ): Promise<void> {
    await this.configuration.pool.query(
      `UPDATE room
          SET ${column} = NULL
        WHERE id = $1 AND ${column} = $2`,
      [roomId, sentAt],
    )
  }

  private async reconcileMissedWarnings(room: RoomRow): Promise<void> {
    const now = new Date(this.configuration.clock.now())
    const lifetime = new Date(room.createdAt.getTime() + ROOM_LIFETIME_MS)
    if (now.getTime() >= lifetime.getTime()) return
    await this.configuration.pool.query(
      `UPDATE room
          SET warning_30_sent_at = CASE
                WHEN warning_30_sent_at IS NULL
                 AND $2::timestamp >= $3::timestamp
                 AND $2::timestamp < $5::timestamp THEN $2::timestamp
                ELSE warning_30_sent_at
              END,
              warning_10_sent_at = CASE
                WHEN warning_10_sent_at IS NULL
                 AND $2::timestamp >= $4::timestamp
                 AND $2::timestamp < $5::timestamp THEN $2::timestamp
                ELSE warning_10_sent_at
              END,
              warning_1_sent_at = CASE
                WHEN warning_1_sent_at IS NULL
                 AND $2::timestamp >= $6::timestamp
                 AND $2::timestamp < $5::timestamp THEN $2::timestamp
                ELSE warning_1_sent_at
              END
        WHERE id = $1 AND ended_at IS NULL`,
      [
        room.id,
        now,
        new Date(lifetime.getTime() - 30 * 60_000),
        new Date(lifetime.getTime() - 10 * 60_000),
        lifetime,
        new Date(lifetime.getTime() - 60_000),
      ],
    )
  }

  private report(error: unknown): void {
    try {
      this.configuration.onError?.(error)
    } catch {
      // Reporting must not prevent callback retry.
    }
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
