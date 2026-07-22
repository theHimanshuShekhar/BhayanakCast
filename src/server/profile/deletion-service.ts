import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { Pool, PoolClient } from 'pg'
import {
  getProductionAuth,
  readSessionProjection,
} from '../auth/auth'
import type { RoomService } from '../rooms/room-service'

export type DeletionRequestStatus = 'pending' | 'cancelled' | 'rejected' | 'approved'
export type DeletionAuditEvent = 'submitted' | 'cancelled' | 'rejected' | 'approved'

export interface DeletionRequest {
  readonly requestId: string
  readonly accountId: string
  readonly status: DeletionRequestStatus
  readonly requestedAt: Date
  readonly resolvedAt: Date | null
}

export type DeletionCommandResult =
  | DeletionRequest
  | { readonly status: 'not-found' }

interface DeletionRequestRow {
  requestId: string
  accountId: string
  status: DeletionRequestStatus
  requestedAt: Date
  resolvedAt: Date | null
}

interface DeletionRuntimeState {
  pool?: Pool
  roomService?: Pick<RoomService, 'setDeletionPending' | 'setDeletionPendingInTransaction'>
  revokeConnections?: (accountId: string) => Promise<void> | void
}

const globalDeletion = globalThis as typeof globalThis & {
  __bhayanakCastDeletion?: DeletionRuntimeState
}
const deletionState = (globalDeletion.__bhayanakCastDeletion ??= {})

export function bindDeletionRuntime(runtime: DeletionRuntimeState) {
  if (Object.hasOwn(runtime, 'pool')) deletionState.pool = runtime.pool
  if (runtime.roomService) deletionState.roomService = runtime.roomService
  if (runtime.revokeConnections) deletionState.revokeConnections = runtime.revokeConnections
}
export function createDeletionService(
  pool: Pool,
  options: {
    readonly roomService?: Pick<
      RoomService,
      'setDeletionPending' | 'setDeletionPendingInTransaction'
    >
    readonly revokeConnections?: (accountId: string) => Promise<void> | void
    readonly now?: () => Date
  } = {},
) {
  const now = options.now ?? (() => new Date())

  return {
    async current(accountId: string): Promise<DeletionRequestCommandResult> {
      const result = await pool.query<DeletionRequestRow>(
        `SELECT id AS "requestId", account_id AS "accountId", status,
                requested_at AS "requestedAt", resolved_at AS "resolvedAt"
           FROM deletion_request
          WHERE account_id = $1
          ORDER BY requested_at DESC,
                   (status = 'pending') DESC,
                   resolved_at DESC NULLS LAST,
                   id DESC
          LIMIT 1`,
        [accountId],
      )
      return result.rows[0] ? mapRequest(result.rows[0]) : { status: 'not-found' }
    },

    async submit(accountId: string): Promise<DeletionRequest> {
      const result = await transaction(pool, async (client) => {
        await lockAccount(client, accountId)
        const existing = await latestRequest(client, accountId, true)
        if (existing?.status === 'pending' || existing?.status === 'approved') {
          await audit(client, existing.requestId, accountId, 'submitted', now())
          return mapRequest(existing)
        }
        if (!options.roomService) {
          const membership = await client.query(
            `SELECT 1
               FROM room_membership
              WHERE account_id = $1
                AND left_at IS NULL
              LIMIT 1`,
            [accountId],
          )
          if (membership.rows[0]) {
            throw new Error('Room lifecycle service is required for active membership')
          }
        }
        const instant = now()
        const requestId = globalThis.crypto.randomUUID()
        const inserted = await client.query<DeletionRequestRow>(
          `INSERT INTO deletion_request
             (id, account_id, status, requested_at)
           VALUES ($1, $2, 'pending', $3)
           RETURNING id AS "requestId", account_id AS "accountId", status,
                     requested_at AS "requestedAt", resolved_at AS "resolvedAt"`,
          [requestId, accountId, instant],
        )
        await client.query(
          `INSERT INTO account_state (account_id, deletion_requested_at)
           VALUES ($1, $2)
           ON CONFLICT (account_id)
           DO UPDATE SET deletion_requested_at = EXCLUDED.deletion_requested_at`,
          [accountId, instant],
        )
        await options.roomService?.setDeletionPendingInTransaction(client, accountId, true)
        await audit(client, requestId, accountId, 'submitted', instant)
        return mapRequest(inserted.rows[0])
      })
      if (result.status === 'pending') {
        await options.revokeConnections?.(accountId)
      }
      return result
    },

    async cancel(accountId: string): Promise<DeletionCommandResult> {
      return transaction(pool, async (client) => {
        await lockAccount(client, accountId)
        const existing = await latestRequest(client, accountId, true)
        if (!existing) return { status: 'not-found' as const }
        if (existing.status !== 'pending') {
          if (existing.status === 'cancelled' || existing.status === 'rejected') {
            await audit(client, existing.requestId, accountId, 'cancelled', now())
          }
          return mapRequest(existing)
        }
        const instant = now()
        const updated = await client.query<DeletionRequestRow>(
          `UPDATE deletion_request
              SET status = 'cancelled', resolved_at = $2
            WHERE id = $1
          RETURNING id AS "requestId", account_id AS "accountId", status,
                    requested_at AS "requestedAt", resolved_at AS "resolvedAt"`,
          [existing.requestId, instant],
        )
        await client.query(
          `UPDATE account_state
              SET deletion_requested_at = NULL
            WHERE account_id = $1`,
          [accountId],
        )
        await options.roomService?.setDeletionPendingInTransaction(client, accountId, false)
        await audit(client, existing.requestId, accountId, 'cancelled', instant)
        return mapRequest(updated.rows[0])
      })
    },

    async respond(
      accountId: string,
      status: Extract<DeletionRequestStatus, 'approved' | 'rejected'>,
      actorId?: string,
    ): Promise<DeletionCommandResult> {
      const result = await transaction(pool, async (client) => {
        await lockAccount(client, accountId)
        const existing = await latestRequest(client, accountId, true)
        if (!existing) return { status: 'not-found' as const }
        if (existing.status !== 'pending') return mapRequest(existing)
        const instant = now()
        const updated = await client.query<DeletionRequestRow>(
          `UPDATE deletion_request
              SET status = $2, resolved_at = $3, resolved_by = $4
            WHERE id = $1
          RETURNING id AS "requestId", account_id AS "accountId", status,
                    requested_at AS "requestedAt", resolved_at AS "resolvedAt"`,
          [existing.requestId, status, instant, actorId ?? null],
        )
        await audit(client, existing.requestId, accountId, status, instant, actorId)
        if (status === 'rejected') {
          await client.query(
            `UPDATE account_state
                SET deletion_requested_at = NULL
              WHERE account_id = $1`,
            [accountId],
          )
          await options.roomService?.setDeletionPendingInTransaction(client, accountId, false)
        } else {
          await client.query(
            `UPDATE account_state
                SET deletion_requested_at = COALESCE(deletion_requested_at, $2)
              WHERE account_id = $1`,
            [accountId, instant],
          )
          await client.query('DELETE FROM session WHERE user_id = $1', [accountId])
        }
        return mapRequest(updated.rows[0])
      })
      if (result.status === 'approved') {
        await options.revokeConnections?.(accountId)
      }
      return result
    },
  }
}

export function getProductionDeletionService() {
  if (!deletionState.pool) throw new Error('DATABASE_URL is required for deletion requests')
  return createDeletionService(deletionState.pool, {
    roomService: deletionState.roomService,
    revokeConnections: deletionState.revokeConnections,
  })
}

export const getDeletionRequest = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DeletionCommandResult> => {
    const session = await currentSession()
    if (!session) return { status: 'not-found' }
    return getProductionDeletionService().current(session.id)
  },
)

export const submitDeletionRequest = createServerFn({ method: 'POST' }).handler(
  async (): Promise<DeletionRequest> => {
    const session = await requireSession()
    return getProductionDeletionService().submit(session.id)
  },
)

export const cancelDeletionRequest = createServerFn({ method: 'POST' }).handler(
  async (): Promise<DeletionCommandResult> => {
    const session = await requireSession()
    return getProductionDeletionService().cancel(session.id)
  },
)

async function currentSession() {
  return readSessionProjection(getProductionAuth(), getRequest().headers)
}

async function requireSession() {
  const session = await currentSession()
  if (!session) throw new Error('Authentication required')
  return session
}

async function lockAccount(client: PoolClient, accountId: string) {
  const account = await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [accountId])
  if (!account.rows[0]) throw new Error('Account not found')
}
async function latestRequest(
  client: PoolClient,
  accountId: string,
  lock: boolean,
): Promise<DeletionRequestRow | null> {
  const result = await client.query<DeletionRequestRow>(
    `SELECT id AS "requestId", account_id AS "accountId", status,
            requested_at AS "requestedAt", resolved_at AS "resolvedAt"
       FROM deletion_request
      WHERE account_id = $1
      ORDER BY requested_at DESC,
               (status = 'pending') DESC,
               resolved_at DESC NULLS LAST,
               id DESC
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [accountId],
  )
  return result.rows[0] ?? null
}

async function audit(
  client: PoolClient,
  requestId: string,
  accountId: string,
  event: DeletionAuditEvent,
  createdAt: Date,
  actorId?: string,
) {
  await client.query(
    `INSERT INTO deletion_request_audit
       (id, request_id, account_id, event, created_at, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [globalThis.crypto.randomUUID(), requestId, accountId, event, createdAt, actorId ?? null],
  )
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
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

function mapRequest(row: DeletionRequestRow): DeletionRequest {
  return {
    requestId: row.requestId,
    accountId: row.accountId,
    status: row.status,
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt,
  }
}

type DeletionRequestCommandResult = DeletionRequest | { readonly status: 'not-found' }
