import { sql } from 'drizzle-orm'
import { db } from '#/db'
import { checkValkeyConnection } from './rate-limit'

type DependencyStatus = 'ok' | 'skipped' | 'error'

type HealthOptions = {
  now?: Date
  checkDatabase?: () => Promise<void>
  checkValkey?: () => Promise<void>
}

async function defaultDatabaseCheck() {
  await db.execute(sql`select 1`)
}

async function defaultValkeyCheck() {
  if (!process.env.VALKEY_URL) return
  await checkValkeyConnection(process.env.VALKEY_URL)
}

async function dependencyStatus(check: () => Promise<void>): Promise<DependencyStatus> {
  try {
    await check()
    return 'ok'
  } catch {
    return 'error'
  }
}

export async function createHealthPayload(options: HealthOptions = {}) {
  const now = options.now ?? new Date()
  const database = await dependencyStatus(
    options.checkDatabase ?? defaultDatabaseCheck,
  )
  const valkey = process.env.VALKEY_URL
    ? await dependencyStatus(options.checkValkey ?? defaultValkeyCheck)
    : options.checkValkey
      ? await dependencyStatus(options.checkValkey)
      : 'skipped'

  return {
    ok: database === 'ok' && valkey !== 'error',
    service: 'bhayanakcast',
    time: now.toISOString(),
    dependencies: {
      database,
      valkey,
    },
  } as const
}
