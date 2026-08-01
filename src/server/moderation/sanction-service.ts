import type { Pool, PoolClient } from 'pg'
import type { SanctionType } from '../auth/account-access-policy'
import type { RoomService } from '../rooms/room-service'

export const SANCTION_DEFAULT_MS = 7 * 24 * 60 * 60 * 1_000

export interface SanctionAdminActor {
  readonly accountId: string
  readonly isPlatformAdmin: boolean
}

export interface SanctionAccountOption {
  readonly id: string
  readonly displayName: string
}

export interface PlatformSanctionRecord {
  readonly id: string
  readonly accountId: string | null
  readonly displayName: string
  readonly type: SanctionType
  readonly startsAt: Date
  readonly expiresAt: Date | null
  readonly liftedAt: Date | null
  readonly status: 'active' | 'expired' | 'lifted'
  readonly carriedForward: boolean
}

export interface SanctionDashboard {
  readonly accounts: readonly SanctionAccountOption[]
  readonly sanctions: readonly PlatformSanctionRecord[]
}

export class PlatformAdminSanctionAuthorizationError extends Error {
  constructor() {
    super('Platform Admin authorization required')
    this.name = 'PlatformAdminSanctionAuthorizationError'
  }
}

interface SanctionServiceConfiguration {
  readonly pool: Pool
  readonly roomService: RoomService
  readonly now?: () => Date
  readonly revokeConnections?: (accountId: string) => void | Promise<void>
  readonly audit?: (entry: Readonly<Record<string, unknown>>) => void
}

interface SanctionRow {
  readonly id: string
  readonly accountId: string | null
  readonly displayName: string | null
  readonly type: SanctionType
  readonly startsAt: Date
  readonly expiresAt: Date | null
  readonly liftedAt: Date | null
  readonly originSanctionId: string | null
}

export class SanctionService {
  private readonly now: () => Date
  private readonly audit: (entry: Readonly<Record<string, unknown>>) => void

  constructor(private readonly configuration: SanctionServiceConfiguration) {
    this.now = configuration.now ?? (() => new Date())
    this.audit = configuration.audit ?? writeOperationalLog
  }

  async dashboard(actor: SanctionAdminActor): Promise<SanctionDashboard> {
    authorize(actor)
    const [accounts, sanctions] = await Promise.all([
      this.configuration.pool.query<SanctionAccountOption>(
        `SELECT id, name AS "displayName"
           FROM "user"
          ORDER BY lower(name), id`,
      ),
      this.configuration.pool.query<SanctionRow>(
        `SELECT sanction.id,
                sanction.account_id AS "accountId",
                account.name AS "displayName",
                sanction.type,
                sanction.starts_at AS "startsAt",
                sanction.expires_at AS "expiresAt",
                sanction.lifted_at AS "liftedAt",
                sanction.origin_sanction_id AS "originSanctionId"
           FROM platform_sanction sanction
           LEFT JOIN "user" account ON account.id = sanction.account_id
          ORDER BY sanction.starts_at DESC, sanction.id DESC`,
      ),
    ])
    const instant = this.now()
    return {
      accounts: accounts.rows,
      sanctions: sanctions.rows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        displayName: row.displayName ?? 'Deleted account',
        type: row.type,
        startsAt: row.startsAt,
        expiresAt: row.expiresAt,
        liftedAt: row.liftedAt,
        status: row.liftedAt
          ? 'lifted'
          : row.expiresAt && row.expiresAt.getTime() <= instant.getTime()
            ? 'expired'
            : 'active',
        carriedForward: row.originSanctionId !== null,
      })),
    }
  }

  async apply(
    actor: SanctionAdminActor,
    input: {
      readonly accountId: string
      readonly type: SanctionType
      readonly expiresAt?: Date | null
    },
  ) {
    authorize(actor)
    const result = await this.configuration.roomService.applySanction(input)
    if (input.type === 'all_access') {
      await this.configuration.revokeConnections?.(input.accountId)
    }
    this.record({
      event: 'platform_sanction.applied',
      actorAccountId: actor.accountId,
      targetAccountId: input.accountId,
      sanctionId: result.sanctionId,
      sanctionType: input.type,
      duration: input.expiresAt === null ? 'indefinite' : input.expiresAt ? 'custom' : 'default-seven-days',
      outcome: 'applied',
    })
    return result
  }

  async lift(actor: SanctionAdminActor, sanctionId: string) {
    authorize(actor)
    const instant = this.now()
    const result = await this.transaction(async (client) => {
      const selected = await client.query<{
        id: string
        accountId: string | null
        type: SanctionType
        expiresAt: Date | null
        liftedAt: Date | null
        originSanctionId: string | null
      }>(
        `SELECT id,
                account_id AS "accountId",
                type,
                expires_at AS "expiresAt",
                lifted_at AS "liftedAt",
                origin_sanction_id AS "originSanctionId"
           FROM platform_sanction
          WHERE id = $1
          FOR UPDATE`,
        [sanctionId],
      )
      const sanction = selected.rows[0]
      if (!sanction) return { status: 'not-found' as const }
      if (sanction.liftedAt || (sanction.expiresAt && sanction.expiresAt <= instant)) {
        return { status: 'already-inactive' as const, sanction }
      }
      const originId = sanction.originSanctionId ?? sanction.id
      await client.query(
        `UPDATE platform_sanction
            SET lifted_at = $2
          WHERE (id = $1 OR origin_sanction_id = $1)
            AND lifted_at IS NULL`,
        [originId, instant],
      )
      return { status: 'lifted' as const, sanction }
    })
    if (result.status === 'lifted' && result.sanction.accountId) {
      const membership = await this.configuration.roomService.currentMembership(result.sanction.accountId)
      if (membership) {
        await this.configuration.roomService.publishRoomTransitions([{ roomId: membership.roomId }])
      }
    }
    this.record({
      event: 'platform_sanction.lifted',
      actorAccountId: actor.accountId,
      targetAccountId: result.status === 'not-found' ? null : result.sanction.accountId,
      sanctionId,
      sanctionType: result.status === 'not-found' ? null : result.sanction.type,
      outcome: result.status,
    })
    return result
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.configuration.pool.connect()
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

  private record(entry: Readonly<Record<string, unknown>>) {
    try {
      this.audit({ level: 'info', ...entry, occurredAt: this.now().toISOString() })
    } catch {
      // A private audit sink cannot turn a committed moderation action into failure.
    }
  }
}

function authorize(actor: SanctionAdminActor) {
  if (!actor.isPlatformAdmin) throw new PlatformAdminSanctionAuthorizationError()
}

function writeOperationalLog(entry: Readonly<Record<string, unknown>>) {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }))
}

interface SanctionRuntime {
  pool?: Pool
  roomService?: RoomService
  now?: () => Date
  revokeConnections?: (accountId: string) => void | Promise<void>
}

const SANCTION_RUNTIME_KEY = Symbol.for('bhayanakcast.sanction-runtime')

function runtime(): SanctionRuntime {
  const shared = globalThis as typeof globalThis & { [SANCTION_RUNTIME_KEY]?: SanctionRuntime }
  return (shared[SANCTION_RUNTIME_KEY] ??= {})
}

export function bindSanctionRuntime(configuration: Partial<SanctionRuntime>) {
  Object.assign(runtime(), configuration)
}

export function getSanctionService(): SanctionService {
  const configuration = runtime()
  if (!configuration.pool || !configuration.roomService) {
    throw new Error('Platform Sanction service is not configured')
  }
  return new SanctionService({
    pool: configuration.pool,
    roomService: configuration.roomService,
    now: configuration.now,
    revokeConnections: configuration.revokeConnections,
  })
}
