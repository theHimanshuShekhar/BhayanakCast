import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool, type QueryResultRow } from 'pg'
import { TestClock } from './test-clock'

export interface TestEnvironment {
  readonly workerId: string
  readonly schema: string
  readonly valkeyPrefix: string
  readonly clock: TestClock
  readonly databaseUrl: string
  readonly valkeyUrl: string
  sql<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
  set(key: string, value: string): Promise<'OK'>
  get(key: string): Promise<string | null>
  cleanup(): Promise<void>
}

export async function createTestEnvironment(
  workerId: string,
): Promise<TestEnvironment> {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  const valkeyUrl = process.env.TEST_VALKEY_URL ?? process.env.VALKEY_URL
  if (!databaseUrl || !valkeyUrl) {
    throw new Error(
      'TEST_DATABASE_URL/DATABASE_URL and TEST_VALKEY_URL/VALKEY_URL are required',
    )
  }

  const safeWorkerId =
    workerId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/^_+|_+$/g, '') || 'worker'
  const unique = randomUUID().replaceAll('-', '').slice(0, 10)
  const schema = `${`test_${safeWorkerId}`.slice(0, 52)}_${unique}`
  const valkeyPrefix = `${schema}:`
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: `bhayanakcast-test-${safeWorkerId}`,
  })
  const valkey = new Redis(valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })

  const provisionResults = await Promise.allSettled([
    pool.query(`CREATE SCHEMA "${schema}"`),
    valkey.connect(),
  ])
  const provisionErrors = rejectedReasons(provisionResults)
  if (provisionErrors.length > 0) {
    const cleanupResults = await Promise.allSettled([
      pool.end(),
      closeRedis(valkey),
      cleanBoundResources(databaseUrl, valkeyUrl, schema, valkeyPrefix),
    ])
    throw new AggregateError(
      [...provisionErrors, ...rejectedReasons(cleanupResults)],
      'Failed to provision isolated test resources',
    )
  }

  let originalResourcesClosed = false
  const closeOriginalResources = async () => {
    if (originalResourcesClosed) return
    originalResourcesClosed = true
    await allOrThrow(
      [pool.end(), closeRedis(valkey)],
      'Failed to close isolated test clients',
    )
  }

  let cleaned = false
  let cleanupPromise: Promise<void> | undefined
  const cleanup = () => {
    if (cleaned) return Promise.resolve()
    cleanupPromise ??= (async () => {
      const closeResults = await Promise.allSettled([closeOriginalResources()])
      const cleanupResults = await Promise.allSettled([
        cleanBoundResources(databaseUrl, valkeyUrl, schema, valkeyPrefix),
      ])
      const errors = [
        ...rejectedReasons(closeResults),
        ...rejectedReasons(cleanupResults),
      ]
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Failed to clean isolated test resources')
      }
      cleaned = true
    })().catch((error: unknown) => {
      cleanupPromise = undefined
      throw error
    })
    return cleanupPromise
  }

  const sql = async <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => {
    const client = await pool.connect()
    try {
      await client.query(`SELECT set_config('search_path', $1, false)`, [
        schema,
      ])
      return await client.query<T>(text, values)
    } finally {
      client.release()
    }
  }

  return {
    workerId,
    schema,
    valkeyPrefix,
    clock: new TestClock(0),
    databaseUrl,
    valkeyUrl,
    sql,
    set: (key, value) => valkey.set(`${valkeyPrefix}${key}`, value),
    get: (key) => valkey.get(`${valkeyPrefix}${key}`),
    cleanup,
  }
}

async function cleanBoundResources(
  databaseUrl: string,
  valkeyUrl: string,
  schema: string,
  valkeyPrefix: string,
) {
  const pool = new Pool({ connectionString: databaseUrl })
  const valkey = new Redis(valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  const operationErrors: unknown[] = []
  try {
    const results = await Promise.allSettled([
      (async () => {
        await valkey.connect()
        await deleteKeys(valkey, `${valkeyPrefix}*`)
      })(),
      pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`),
    ])
    operationErrors.push(...rejectedReasons(results))
  } finally {
    const closeResults = await Promise.allSettled([
      pool.end(),
      closeRedis(valkey),
    ])
    operationErrors.push(...rejectedReasons(closeResults))
  }
  if (operationErrors.length > 0) {
    throw new AggregateError(operationErrors, 'Bound resource cleanup failed')
  }
}

async function deleteKeys(valkey: Redis, pattern: string) {
  let cursor = '0'
  do {
    const [next, keys] = await valkey.scan(cursor, 'MATCH', pattern)
    cursor = next
    if (keys.length > 0) await valkey.del(...keys)
  } while (cursor !== '0')
}

async function closeRedis(valkey: Redis) {
  if (valkey.status === 'wait' || valkey.status === 'end') {
    valkey.disconnect()
    return
  }
  await valkey.quit()
}

async function allOrThrow(promises: Promise<unknown>[], message: string) {
  const errors = rejectedReasons(await Promise.allSettled(promises))
  if (errors.length > 0) throw new AggregateError(errors, message)
}

function rejectedReasons(results: PromiseSettledResult<unknown>[]) {
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )
}
