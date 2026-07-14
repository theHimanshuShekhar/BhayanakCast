import { expect, test } from 'vitest'
import { createTestCoordinator } from '../helpers/test-coordinator'
import { getIntegrationContext } from '../setup/integration'

test('worker B cannot observe worker A resources', async () => {
  const context = await getIntegrationContext()
  const coordinator = await createTestCoordinator()
  try {
    const first = await coordinator.receive()

    expect(context.workerId).not.toBe(first.workerId)
    expect(context.environment.schema).not.toBe(first.schema)
    expect(context.environment.valkeyPrefix).not.toBe(first.valkeyPrefix)
    expect(context.server.port).not.toBe(first.port)
    await expect(context.server.sql('SELECT * FROM marker')).rejects.toThrow()
    expect(await context.server.get('marker')).toBeNull()
  } finally {
    await coordinator.cleanup()
  }
})
