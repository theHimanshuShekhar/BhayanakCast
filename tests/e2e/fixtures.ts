import { randomUUID } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { BrowserContext, Locator, Page } from '@playwright/test'
import {
  createTestAccountHarness,
  type StoredDiscordOAuthTokens,
  type DiscordTestProfile,
  type TestAccountHarness,
} from '../helpers/test-account'
import { createTestEnvironment } from '../helpers/test-environment'
import { startTestServer } from '../helpers/test-server'
import { createJourneyRecorder, type JourneyRecorder } from './journey-evidence'

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
  respondToDeletion(
    accountId: string,
    status: 'approved' | 'rejected',
  ): Promise<void>
}

export const test = base.extend<{
  authSessions: AuthSessionFixture
  journeyEvidence: JourneyRecorder
}>({
  /** Auto so the #26 matrix records every test, including the specs that never ask for
      an authenticated context. Patching `browser.newContext` for the test's lifetime is
      what makes that automatic: contexts built inside `createBrowserContext` are
      instrumented without every spec having to opt in. */
  journeyEvidence: [
    async ({ browser }, use, testInfo) => {
      const recorder = createJourneyRecorder(testInfo)
      const openContext = browser.newContext.bind(browser)
      browser.newContext = async (options) => {
        const context = await openContext(options)
        await recorder.instrumentContext(context)
        return context
      }
      try {
        await use(recorder)
      } finally {
        browser.newContext = openContext
        await recorder.flush()
      }
    },
    { auto: true },
  ],
  authSessions: async ({ browser, journeyEvidence }, use, testInfo) => {
    const environment = await createTestEnvironment(
      `e2e-${testInfo.workerIndex}-${process.pid}-${randomUUID()}`,
    )
    const server = await startTestServer(environment)
    let accounts: TestAccountHarness | undefined
    const contexts: BrowserContext[] = []
    try {
      accounts = await createTestAccountHarness(
        {
          workerId: environment.workerId,
          environment,
          server,
        },
        { deleteUsersOnCleanup: false },
      )
      await use({
        origin: server.origin,
        sql: server.sql,
        respondToDeletion(accountId, status) {
          return accounts!.respondToDeletion(accountId, status)
        },
        async createBrowserContext(profile) {
          const signedIn = await accounts!.signInDiscord(profile)
          journeyEvidence.recordAccount()
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
// This waits after a real navigation; it is not a replacement for page.reload().
export async function gotoHydrated(page: Page, url: string) {
  await page.goto(url)
  await expect(page.locator('body')).toHaveAttribute('data-hydrated', 'true')
}


/** Preflight zeroes the auto margins the UA uses to centre an open modal, so a
    dialog only sits in the middle of the viewport while the base `dialog` rule
    puts them back. Full-bleed phone sheets pass too: they fill the viewport, so
    the gaps on both sides are equal at zero. */
export async function expectCenteredModal(dialog: Locator) {
  const gaps = await dialog.evaluate((node) => {
    const box = node.getBoundingClientRect()
    return {
      x: box.left - (window.innerWidth - box.right),
      y: box.top - (window.innerHeight - box.bottom),
    }
  })
  expect(Math.abs(gaps.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(gaps.y)).toBeLessThanOrEqual(1)
}
