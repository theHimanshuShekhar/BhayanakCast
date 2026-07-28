import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterEach, expect, test } from 'vitest'
import { createServerRuntime } from '../../src/server/runtime'
import { getIntegrationContext } from '../setup/integration'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function unmigratedSchema() {
  const context = await getIntegrationContext()
  const schema = `startup_${randomUUID().replaceAll('-', '')}`.slice(0, 60)
  const admin = new Pool({ connectionString: context.environment.databaseUrl })
  cleanups.push(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.end()
  })
  const runtime = () =>
    createServerRuntime({
      DATABASE_URL: context.environment.databaseUrl,
      DATABASE_SCHEMA: schema,
    } as NodeJS.ProcessEnv)
  const tables = async () => {
    const observed = await admin.query<{ name: string }>(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1',
      [schema],
    )
    return observed.rows.map((row) => row.name)
  }
  return { runtime, tables }
}

test('startup provisions and migrates a schema that does not exist yet', async () => {
  const subject = await unmigratedSchema()
  expect(await subject.tables()).toEqual([])

  const runtime = subject.runtime()
  await runtime.migrate()
  await runtime.close()

  // Every table the room surfaces need, including the ones added last.
  expect(await subject.tables()).toEqual(
    expect.arrayContaining(['user', 'room', 'room_membership', 'message', 'report']),
  )
})

test('a second startup against a current schema changes nothing', async () => {
  const subject = await unmigratedSchema()
  const first = subject.runtime()
  await first.migrate()
  await first.close()
  const before = (await subject.tables()).sort()

  const second = subject.runtime()
  await second.migrate()
  await second.close()

  expect((await subject.tables()).sort()).toEqual(before)
})
