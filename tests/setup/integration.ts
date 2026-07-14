import { afterAll } from 'vitest'
import {
  createTestEnvironment,
  type TestEnvironment,
} from '../helpers/test-environment'
import {
  startTestServer,
  type TestServer,
} from '../helpers/test-server'

export interface IntegrationContext {
  readonly workerId: string
  readonly environment: TestEnvironment
  readonly server: TestServer
}

let contextPromise: Promise<IntegrationContext> | undefined

export function getIntegrationContext() {
  contextPromise ??= createIntegrationContext()
  return contextPromise
}

afterAll(async () => {
  if (!contextPromise) return
  const context = await contextPromise
  await Promise.all([
    context.server.stop(),
    context.environment.cleanup(),
  ])
})

async function createIntegrationContext(): Promise<IntegrationContext> {
  const poolId =
    process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0'
  const workerId = `integration-${poolId}-${process.pid}`
  const environment = await createTestEnvironment(workerId)
  try {
    const server = await startTestServer(environment)
    return {
      workerId,
      environment,
      server,
    }
  } catch (error) {
    await environment.cleanup()
    throw error
  }
}
