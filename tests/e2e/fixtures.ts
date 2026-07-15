import { randomUUID } from 'node:crypto'
import { test as base } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'
import {
  createTestAccountHarness,
  type StoredDiscordOAuthTokens,
  type DiscordTestProfile,
  type TestAccountHarness,
} from '../helpers/test-account'
import { createTestEnvironment } from '../helpers/test-environment'
import { startTestServer } from '../helpers/test-server'

export interface AuthenticatedBrowserContext {
  readonly context: BrowserContext
  readonly sessionCookie: string
}

export interface AuthSessionFixture {
  readonly origin: string
  createBrowserContext(
    profile: DiscordTestProfile,
  ): Promise<AuthenticatedBrowserContext>
  inspectDiscordTokens(discordId: string): Promise<StoredDiscordOAuthTokens>
  sql(text: string, values?: unknown[]): Promise<unknown[]>
}

export const test = base.extend<{ authSessions: AuthSessionFixture }>({
  authSessions: async ({ browser }, use, testInfo) => {
    const environment = await createTestEnvironment(
      `e2e-${testInfo.workerIndex}-${process.pid}-${randomUUID()}`,
    )
    const server = await startTestServer(environment)
    let accounts: TestAccountHarness | undefined
    const contexts: BrowserContext[] = []
    try {
      accounts = await createTestAccountHarness({
        workerId: environment.workerId,
        environment,
        server,
      })
      await use({
        origin: server.origin,
        sql: server.sql,
        async createBrowserContext(profile) {
          const signedIn = await accounts!.signInDiscord(profile)
          const separator = signedIn.sessionCookie.indexOf('=')
          if (separator < 1) throw new Error('Test sign-in returned an invalid cookie')
          const context = await browser.newContext({ baseURL: server.origin })
          contexts.push(context)
          await context.addCookies([
            {
              name: signedIn.sessionCookie.slice(0, separator),
              value: signedIn.sessionCookie.slice(separator + 1),
              url: server.origin,
            },
          ])
          return { context, sessionCookie: signedIn.sessionCookie }
        },
        inspectDiscordTokens(discordId) {
          return accounts!.inspectDiscordTokens(discordId)
        },
      })
    } finally {
      const failures: unknown[] = []
      const contextResults = await Promise.allSettled(
        contexts.map((context) => context.close()),
      )
      failures.push(
        ...contextResults
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason),
      )

      const serverResults = await Promise.allSettled([
        accounts?.cleanup() ?? Promise.resolve(),
        server.stop(),
      ])
      failures.push(
        ...serverResults
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason),
      )

      try {
        await environment.cleanup()
      } catch (error) {
        failures.push(error)
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Auth E2E fixture cleanup failed')
      }
    }
  },
})

export { expect } from '@playwright/test'
