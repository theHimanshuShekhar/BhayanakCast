import Redis from 'ioredis'
import { Pool, type QueryResultRow } from 'pg'
import { migrateAuthDatabase } from './db/migrate'
import {
  ControlledClock,
  SystemClock,
  type Clock,
} from './time'

export interface RuntimeBindings {
  readonly workerId: string | null
  readonly databaseSchema: string
  readonly valkeyPrefix: string
  readonly clockEpochMs: number
}

export class ServerRuntime {
  readonly bindings: RuntimeBindings
  readonly clock: Clock
  private readonly database?: Pool
  private readonly valkey?: Redis

  constructor(
    bindings: RuntimeBindings,
    clock: Clock,
    database?: Pool,
    valkey?: Redis,
  ) {
    this.bindings = bindings
    this.clock = clock
    this.database = database
    this.valkey = valkey
  }

  getDatabasePool(): Pool | undefined {
    return this.database
  }
  getValkey(): Redis | undefined {
    return this.valkey
  }

  /** Brings the bound schema up to the shipped migrations before the process
      serves anything. Every entry point calls this, so a fresh database, a
      per-worker test schema and an upgraded deployment all reach the same
      state by the same path. Drizzle's journal makes it a no-op once the
      schema is current. */
  async migrate() {
    if (!this.database) return
    // The identifier is validated in `createServerRuntime`.
    await this.database.query(
      `CREATE SCHEMA IF NOT EXISTS "${this.bindings.databaseSchema}"`,
    )
    await migrateAuthDatabase(this.database, this.bindings.databaseSchema)
  }

  async sql<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) {
    if (!this.database) throw new Error('database runtime is not configured')
    const result = await this.database.query<T>(text, values)
    return result.rows
  }

  async set(key: string, value: string) {
    if (!this.valkey) throw new Error('Valkey runtime is not configured')
    return this.valkey.set(key, value)
  }

  async get(key: string) {
    if (!this.valkey) throw new Error('Valkey runtime is not configured')
    return this.valkey.get(key)
  }

  advanceClock(instant: number) {
    if (!(this.clock instanceof ControlledClock)) {
      throw new Error('runtime clock is not controllable')
    }
    this.clock.advanceTo(instant)
    return this.clock.now()
  }

  async close() {
    const pending: Promise<unknown>[] = []
    if (this.database) pending.push(this.database.end())
    if (this.valkey) {
      if (this.valkey.status === 'wait') {
        this.valkey.disconnect()
      } else {
        pending.push(this.valkey.quit())
      }
    }
    await Promise.all(pending)
  }
}

export function createServerRuntime(
  environment: NodeJS.ProcessEnv,
): ServerRuntime {
  const workerId = environment.TEST_WORKER_ID || null
  const databaseSchema = environment.DATABASE_SCHEMA || 'public'
  if (!/^[a-z0-9_]+$/.test(databaseSchema)) {
    throw new Error('DATABASE_SCHEMA must be a lowercase PostgreSQL identifier')
  }
  const valkeyPrefix = environment.VALKEY_PREFIX ?? ''
  const controlledEpoch = environment.CLOCK_EPOCH_MS
  const clock =
    workerId && controlledEpoch !== undefined
      ? new ControlledClock(parseEpoch(controlledEpoch))
      : new SystemClock()
  const database = environment.DATABASE_URL
    ? new Pool({
        connectionString: environment.DATABASE_URL,
        application_name: workerId ?? 'bhayanakcast',
        options: `-c search_path=${databaseSchema},public`,
      })
    : undefined
  const valkey = environment.VALKEY_URL
    ? new Redis(environment.VALKEY_URL, {
        keyPrefix: valkeyPrefix,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      })
    : undefined

  return new ServerRuntime(
    {
      workerId,
      databaseSchema,
      valkeyPrefix,
      clockEpochMs: clock.now(),
    },
    clock,
    database,
    valkey,
  )
}

function parseEpoch(value: string) {
  const epoch = Number(value)
  if (!Number.isFinite(epoch)) throw new Error('CLOCK_EPOCH_MS must be finite')
  return epoch
}
