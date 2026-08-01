import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { Pool, PoolClient } from 'pg'
import {
  getProductionAuth,
  readSessionProjection,
} from '../auth/auth'
import type { AffectedRoomTransition, RoomService } from '../rooms/room-service'
import type {
  AccountLifecycleAnalytics,
  AccountLifecycleEventName,
} from '../observability/account-lifecycle-analytics'
import { createEnforcementKey } from '../moderation/sanction-enforcement'

export type DeletionRequestStatus = 'pending' | 'cancelled' | 'rejected' | 'approved'
export type DeletionAuditEvent = 'submitted' | 'cancelled' | 'rejected' | 'approved'

export interface DeletionRequest {
  readonly requestId: string
  readonly accountId: string
  readonly status: DeletionRequestStatus
  readonly requestedAt: Date
  readonly resolvedAt: Date | null
}

export interface PendingDeletionReview extends DeletionRequest {
  readonly displayName: string
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
  roomService?: Pick<
    RoomService,
    'setDeletionPending' | 'setDeletionPendingInTransaction' | 'publishRoomTransitions'
  >
  revokeConnections?: (accountId: string) => Promise<void> | void
  analytics?: AccountLifecycleAnalytics
  enforcementSecret?: string
}

const globalDeletion = globalThis as typeof globalThis & {
  __bhayanakCastDeletion?: DeletionRuntimeState
}
const deletionState = (globalDeletion.__bhayanakCastDeletion ??= {})

export function bindDeletionRuntime(runtime: DeletionRuntimeState) {
  if (Object.hasOwn(runtime, 'pool')) deletionState.pool = runtime.pool
  if (runtime.roomService) deletionState.roomService = runtime.roomService
  if (runtime.revokeConnections) deletionState.revokeConnections = runtime.revokeConnections
  if (runtime.analytics) deletionState.analytics = runtime.analytics
  if (runtime.enforcementSecret) deletionState.enforcementSecret = runtime.enforcementSecret
}
export function createDeletionService(
  pool: Pool,
  options: {
    readonly roomService?: Pick<
      RoomService,
      'setDeletionPending' | 'setDeletionPendingInTransaction' | 'publishRoomTransitions'
    >
    readonly revokeConnections?: (accountId: string) => Promise<void> | void
    readonly now?: () => Date
    readonly analytics?: AccountLifecycleAnalytics
    readonly enforcementKey?: (discordId: string) => string | Promise<string>
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

    async pending(): Promise<readonly PendingDeletionReview[]> {
      const result = await pool.query<DeletionRequestRow & { displayName: string }>(
        `SELECT request.id AS "requestId", request.account_id AS "accountId",
                request.status, request.requested_at AS "requestedAt",
                request.resolved_at AS "resolvedAt", account.name AS "displayName"
           FROM deletion_request request
           JOIN "user" account ON account.id = request.account_id
          WHERE request.status = 'pending'
          ORDER BY request.requested_at ASC, request.id ASC`,
      )
      return result.rows.map((row) => ({ ...mapRequest(row), displayName: row.displayName }))
    },

    async submit(accountId: string): Promise<DeletionRequest> {
      let affectedRooms: readonly AffectedRoomTransition[] = []
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
        affectedRooms = (await options.roomService?.setDeletionPendingInTransaction(
          client,
          accountId,
          true,
        )) ?? []
        await audit(client, requestId, accountId, 'submitted', instant)
        return mapRequest(inserted.rows[0])
      })
      await options.roomService?.publishRoomTransitions(affectedRooms)
      if (result.status === 'pending') {
        await options.revokeConnections?.(accountId)
      }
      if (result.status === 'pending') {
        await record(options.analytics, 'account_deletion_requested', accountId, pool)
      }
      return result
    },

    async cancel(accountId: string): Promise<DeletionCommandResult> {
      let affectedRooms: readonly AffectedRoomTransition[] = []
      const result = await transaction(pool, async (client) => {
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
        affectedRooms = (await options.roomService?.setDeletionPendingInTransaction(
          client,
          accountId,
          false,
        )) ?? []
        await audit(client, existing.requestId, accountId, 'cancelled', instant)
        return mapRequest(updated.rows[0])
      })
      await options.roomService?.publishRoomTransitions(affectedRooms)
      if (result.status === 'cancelled') {
        await record(options.analytics, 'account_deletion_cancelled', accountId, pool)
      }
      return result
    },

    async respond(
      accountId: string,
      status: Extract<DeletionRequestStatus, 'approved' | 'rejected'>,
      actorId?: string,
    ): Promise<DeletionCommandResult> {
      let transitioned = false
      let affectedRooms: readonly AffectedRoomTransition[] = []
      const result = await transaction(pool, async (client) => {
        await lockAccount(client, accountId)
        const existing = await latestRequest(client, accountId, true)
        if (!existing) return { status: 'not-found' as const }
        if (existing.status !== 'pending') return mapRequest(existing)
        transitioned = true
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
          affectedRooms = (await options.roomService?.setDeletionPendingInTransaction(
            client,
            accountId,
            false,
          )) ?? []
        } else {
          const discordIdentity = await client.query<{ discordId: string }>(
            `SELECT account_id AS "discordId"
               FROM account
              WHERE user_id = $1 AND provider_id = 'discord'
              FOR UPDATE`,
            [accountId],
          )
          const discordId = discordIdentity.rows[0]?.discordId
          if (discordId) await forget(options.analytics, discordId)
          await approveDeletion(
            client,
            accountId,
            instant,
            discordId,
            options.enforcementKey,
          )
        }
        return mapRequest(updated.rows[0])
      })
      await options.roomService?.publishRoomTransitions(affectedRooms)
      if (result.status === 'approved') {
        await options.revokeConnections?.(accountId)
      }
      if (transitioned && actorId) {
        await record(
          options.analytics,
          result.status === 'approved'
            ? 'admin_deletion_approved'
            : 'admin_deletion_rejected',
          actorId,
          pool,
        )
      }
      return result
    },
  }
}

export function getProductionDeletionService() {
  if (!deletionState.pool) throw new Error('DATABASE_URL is required for deletion requests')
  const enforcementSecret = deletionState.enforcementSecret
  return createDeletionService(deletionState.pool, {
    roomService: deletionState.roomService,
    revokeConnections: deletionState.revokeConnections,
    analytics: deletionState.analytics,
    enforcementKey: enforcementSecret
      ? (discordId) => createEnforcementKey(enforcementSecret, discordId)
      : undefined,
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


export const getPendingDeletionRequests = createServerFn({ method: 'GET' }).handler(
  async (): Promise<readonly PendingDeletionReview[]> => {
    await requireAdmin()
    return getProductionDeletionService().pending()
  },
)

export const reviewDeletionRequest = createServerFn({ method: 'POST' })
  .validator(validateReviewInput)
  .handler(async ({ data }): Promise<DeletionCommandResult> => {
    const session = await requireAdmin()
    return getProductionDeletionService().respond(data.accountId, data.decision, session.id)
  })

function validateReviewInput(value: unknown): {
  accountId: string
  decision: 'approved' | 'rejected'
} {
  if (!value || typeof value !== 'object') throw new TypeError('Review input is required')
  const input = value as Record<string, unknown>
  if (
    typeof input.accountId !== 'string' ||
    input.accountId.length === 0 ||
    input.accountId.length > 255 ||
    (input.decision !== 'approved' && input.decision !== 'rejected') ||
    Object.keys(input).some((key) => key !== 'accountId' && key !== 'decision')
  ) {
    throw new TypeError('Invalid deletion review input')
  }
  return { accountId: input.accountId, decision: input.decision }
}
async function currentSession() {
  return readSessionProjection(getProductionAuth(), getRequest().headers)
}

async function requireSession() {
  const session = await currentSession()
  if (!session) throw new Error('Authentication required')
  return session
}


async function requireAdmin() {
  const session = await requireSession()
  if (!session.isPlatformAdmin) throw new Error('Not found')
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

async function approveDeletion(
  client: PoolClient,
  accountId: string,
  instant: Date,
  discordId: string | undefined,
  enforcementKey: ((discordId: string) => string | Promise<string>) | undefined,
) {
  const references = await client.query<{ sanctions: boolean; reports: boolean }>(
    `SELECT EXISTS(
              SELECT 1 FROM platform_sanction WHERE account_id = $1
            ) AS sanctions,
            EXISTS(
              SELECT 1 FROM report
               WHERE reporter_account_id = $1
                  OR (target_type = 'account' AND target_id = $1)
            ) AS reports`,
    [accountId],
  )
  const hasReferences = references.rows[0]?.sanctions || references.rows[0]?.reports
  if (hasReferences) {
    const active = await client.query(
      `SELECT 1
         FROM platform_sanction
        WHERE account_id = $1
          AND starts_at <= $2
          AND lifted_at IS NULL
          AND (expires_at IS NULL OR expires_at > $2)
        LIMIT 1`,
      [accountId, instant],
    )
    const key =
      active.rows[0] && discordId && enforcementKey
        ? await enforcementKey(discordId)
        : null
    if (active.rows[0] && !key) {
      throw new Error('Enforcement key configuration is required for active sanctions')
    }
    const subjectId = globalThis.crypto.randomUUID()
    await client.query(
      `INSERT INTO anonymized_subject (id, enforcement_key, created_at)
       VALUES ($1, $2, $3)`,
      [subjectId, key, instant],
    )
    await client.query(
      `UPDATE platform_sanction
          SET account_id = NULL, subject_id = $2
        WHERE account_id = $1`,
      [accountId, subjectId],
    )
    await client.query(
      `UPDATE report
          SET target_id = 'anonymized',
              subject_ref = $2
        WHERE target_type = 'account' AND target_id = $1`,
      [accountId, subjectId],
    )
    await client.query(
      `UPDATE report
          SET reporter_account_id = NULL,
              reporter_subject_ref = $2
        WHERE reporter_account_id = $1`,
      [accountId, subjectId],
    )
  }
  await client.query(
    `UPDATE message
        SET body = '[redacted: account deleted]'
      WHERE membership_id IN (
        SELECT id FROM room_membership WHERE account_id = $1
      )`,
    [accountId],
  )
  await client.query('UPDATE room SET created_by = NULL WHERE created_by = $1', [accountId])
  await client.query(
    'DELETE FROM chat_mute WHERE muting_account_id = $1 OR muted_account_id = $1',
    [accountId],
  )
  await client.query('DELETE FROM account_preference WHERE account_id = $1', [accountId])
  await client.query('DELETE FROM session WHERE user_id = $1', [accountId])
  await client.query('DELETE FROM account WHERE user_id = $1', [accountId])
  await client.query(
    `UPDATE "user"
        SET name = 'Deleted account',
            email = 'deleted+' || id || '@invalid.local',
            image = NULL,
            email_verified = false,
            updated_at = $2
      WHERE id = $1`,
    [accountId, instant],
  )
}


async function forget(
  analytics: AccountLifecycleAnalytics | undefined,
  discordId: string,
) {
  if (!analytics) return
  try {
    await analytics.forget(discordId)
  } catch (error) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'account_lifecycle_analytics_person_forget_failed',
      }),
    )
    throw error
  }
}

async function record(
  analytics: AccountLifecycleAnalytics | undefined,
  event: AccountLifecycleEventName,
  accountId: string,
  pool: Pool,
) {
  if (!analytics) return
  try {
    const identity = await pool.query<{ discordId: string }>(
      `SELECT account_id AS "discordId"
         FROM account
        WHERE user_id = $1 AND provider_id = 'discord'`,
      [accountId],
    )
    if (identity.rows[0]) analytics.record(event, identity.rows[0].discordId)
  } catch {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'account_lifecycle_analytics_record_failed',
      }),
    )
  }
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
