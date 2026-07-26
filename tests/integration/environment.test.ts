import { expect, test } from 'vitest'
import { createTestEnvironment } from '../helpers/test-environment'
import { getIntegrationContext } from '../setup/integration'

test('a worker binds its production host to isolated resources', async () => {
  const context = await getIntegrationContext()
  await context.server.sql('CREATE TABLE marker (value text)')
  await context.server.sql('INSERT INTO marker VALUES ($1)', ['A'])
  await context.server.set('marker', 'A')
  const advancedTo = await context.server.advanceClock(50)

  expect(advancedTo).toBe(50)
  expect(context.server.bindings.workerId).toBe(context.workerId)
  expect(context.server.bindings.databaseSchema).toBe(
    context.environment.schema,
  )
  expect(context.server.bindings.valkeyPrefix).toBe(
    context.environment.valkeyPrefix,
  )
})

test('cleanup remains safe when requested repeatedly', async () => {
  const environment = await createTestEnvironment('cleanup')
  await environment.set('owned', 'value')

  await Promise.all([environment.cleanup(), environment.cleanup()])
  await environment.cleanup()
})
