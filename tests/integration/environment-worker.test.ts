import { expect, test } from 'vitest'
import { createTestEnvironment } from '../helpers/test-environment'
import { startTestServer } from '../helpers/test-server'
import { getIntegrationContext } from '../setup/integration'

test('an independently bound environment cannot observe another environment resources', async () => {
  const first = await getIntegrationContext()
  const secondEnvironment = await createTestEnvironment(`${first.workerId}-peer`)
  const secondServer = await startTestServer(secondEnvironment)
  try {
    await first.server.sql('CREATE TABLE marker (value text)')
    await first.server.sql('INSERT INTO marker VALUES ($1)', ['A'])
    await first.server.set('marker', 'A')

    expect(secondEnvironment.schema).not.toBe(first.environment.schema)
    expect(secondEnvironment.valkeyPrefix).not.toBe(first.environment.valkeyPrefix)
    expect(secondServer.port).not.toBe(first.server.port)
    await expect(secondServer.sql('SELECT * FROM marker')).rejects.toThrow()
    expect(await secondServer.get('marker')).toBeNull()
  } finally {
    await secondServer.stop()
    await secondEnvironment.cleanup()
  }
})
