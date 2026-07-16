import { randomUUID } from 'node:crypto'
import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'

interface TestWindow extends Window {
  __HOME_TEST_REACT_ROOTS__?: Array<{ current?: unknown }>
}

async function pageWithQueryHarness(context: BrowserContext) {
  await context.addInitScript(() => {
    const roots: Array<{ current?: unknown }> = []
    const renderers = new Map<number, unknown>()
    let nextRenderer = 0
    const testWindow = window as TestWindow
    testWindow.__HOME_TEST_REACT_ROOTS__ = roots
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      configurable: true,
      value: {
        renderers,
        supportsFiber: true,
        inject(renderer: unknown) {
          nextRenderer += 1
          renderers.set(nextRenderer, renderer)
          return nextRenderer
        },
        onCommitFiberRoot(_rendererId: number, root: { current?: unknown }) {
          if (!roots.includes(root)) roots.push(root)
        },
        onCommitFiberUnmount() {},
        checkDCE() {},
      },
    })
  })
  const page = await context.newPage()
  await page.goto('/')
  await page.waitForFunction(() => {
    const roots = (window as TestWindow).__HOME_TEST_REACT_ROOTS__
    if (!roots?.length) return false
    const pending = roots.map((root) => root.current)
    const seen = new Set<unknown>()
    while (pending.length > 0) {
      const fiber = pending.pop() as
        | {
            child?: unknown
            sibling?: unknown
            memoizedProps?: { client?: { getQueryCache?: unknown } }
          }
        | undefined
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      if (typeof fiber.memoizedProps?.client?.getQueryCache === 'function') {
        return true
      }
      pending.push(fiber.child, fiber.sibling)
    }
    return false
  })
  return page
}

async function refetchHomeQuery(page: Page, queryKey: readonly string[]) {
  await page.evaluate(async (prefix) => {
    const roots = (window as TestWindow).__HOME_TEST_REACT_ROOTS__ ?? []
    const pending = roots.map((root) => root.current)
    const seen = new Set<unknown>()
    while (pending.length > 0) {
      const fiber = pending.pop() as
        | {
            child?: unknown
            sibling?: unknown
            memoizedProps?: {
              client?: {
                getQueryCache(): {
                  findAll(input: { queryKey: readonly string[] }): Array<{
                    queryKey: readonly unknown[]
                  }>
                }
                refetchQueries(input: {
                  queryKey: readonly unknown[]
                  exact: boolean
                }): Promise<void>
              }
            }
          }
        | undefined
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      const client = fiber.memoizedProps?.client
      if (client && typeof client.getQueryCache === 'function') {
        const query = client.getQueryCache().findAll({ queryKey: prefix })[0]
        if (!query) throw new Error(`Missing query ${JSON.stringify(prefix)}`)
        await client.refetchQueries({ queryKey: query.queryKey, exact: true })
        return
      }
      pending.push(fiber.child, fiber.sibling)
    }
    throw new Error('QueryClient provider was not found')
  }, queryKey)
}

async function navigateHome(page: Page, q: string, waitForCompletion = true) {
  const navigation = page.evaluate(
    async ({ query, wait }) => {
      const roots = (window as TestWindow).__HOME_TEST_REACT_ROOTS__ ?? []
      const pending = roots.map((root) => root.current)
      const seen = new Set<unknown>()
      while (pending.length > 0) {
        const fiber = pending.pop() as
          | {
              child?: unknown
              sibling?: unknown
              memoizedProps?: {
                router?: {
                  navigate(input: {
                    to: string
                    search: { q: string }
                  }): Promise<void>
                }
              }
            }
          | undefined
        if (!fiber || seen.has(fiber)) continue
        seen.add(fiber)
        const router = fiber.memoizedProps?.router
        if (router && typeof router.navigate === 'function') {
          const result = router.navigate({ to: '/', search: { q: query } })
          if (wait) await result
          return
        }
        pending.push(fiber.child, fiber.sibling)
      }
      throw new Error('Router provider was not found')
    },
    { query: q, wait: waitForCompletion },
  )
  if (waitForCompletion) await navigation
}

const recoverableSections = [
  { label: 'Filters', queryKey: ['home', 'facets'] },
  { label: 'Statistics', queryKey: ['home', 'statistics'] },
  { label: 'Connected presence', queryKey: ['home', 'presence'] },
] as const

for (const [index, section] of recoverableSections.entries()) {
  test(`${section.label} fails and retries without replacing Home`, async ({
    authSessions,
  }) => {
    const signedIn = await authSessions.createBrowserContext({
      id: `10293847561029384${index}`,
      username: `recovery-${index}`,
      global_name: `Recovery ${index}`,
      avatar: `recovery-avatar-${index}`,
      email: `recovery-${index}@example.test`,
      verified: true,
    })
    const page = await pageWithQueryHarness(signedIn.context)
    await expect(page.getByRole('heading', { name: 'Live Rooms' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Past Streams' })).toBeVisible()

    let failRequests = true
    const failedUrls: string[] = []
    const recoveredUrls: string[] = []
    await page.route('**/*', async (route) => {
      const request = route.request()
      if (!['fetch', 'xhr'].includes(request.resourceType())) {
        await route.continue()
        return
      }
      if (failRequests) {
        failedUrls.push(request.url())
        await route.abort('failed')
        return
      }
      recoveredUrls.push(request.url())
      await new Promise((resolve) => setTimeout(resolve, 150))
      await route.continue()
    })

    await refetchHomeQuery(page, section.queryKey)
    await expect(
      page.getByText(`${section.label} is unavailable.`),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Live Rooms' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Past Streams' })).toBeVisible()

    const retry = page
      .getByRole('group', { name: `${section.label} section` })
      .getByRole('button', { name: 'Retry' })
    await retry.focus()
    const scrollBefore = await page.evaluate(() => window.scrollY)
    failRequests = false
    await retry.click()
    await expect(retry).toBeFocused()
    await expect(page.getByText(`${section.label} is updating.`)).toBeVisible()
    await expect(
      page.getByText(`${section.label} is unavailable.`),
    ).toBeHidden()
    await expect(
      page.getByRole('group', { name: `${section.label} section` }),
    ).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
    expect(failedUrls.length).toBeGreaterThan(0)
    expect(recoveredUrls).toHaveLength(1)
    expect(new URL(recoveredUrls[0]!).pathname).toBe(
      new URL(failedUrls[0]!).pathname,
    )
  })
}

test('Home hydrates critical SSR sections without duplicate browser fetches', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '102938475610293850',
    username: 'hydration',
    global_name: 'Hydration member',
    avatar: 'hydration-avatar',
    email: 'hydration@example.test',
    verified: true,
  })
  const serverResponse = await signedIn.context.request.get('/')
  expect(serverResponse.ok()).toBe(true)
  const serverHtml = await serverResponse.text()
  expect(serverHtml).toContain('<h2>Live Rooms</h2>')
  expect(serverHtml).toContain('<h2>Filters</h2>')
  expect(serverHtml).toContain('<h2>Statistics</h2>')
  expect(serverHtml).toContain('<h2>Connected presence</h2>')

  const requests: string[] = []
  signedIn.context.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType())) {
      requests.push(request.url())
    }
  })
  const page = await signedIn.context.newPage()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Live Rooms' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Past Streams' })).toBeVisible()
  await page.waitForTimeout(250)
  expect(requests).toEqual([])
})

test('independent SSR requests do not reuse another request cache', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '102938475610293851',
    username: 'isolation',
    global_name: 'Isolation member',
    avatar: 'isolation-avatar',
    email: 'isolation@example.test',
    verified: true,
  })
  const first = await signedIn.context.request.get('/')
  expect(await first.text()).toContain('<p>0<!-- --> rooms available.</p>')

  const users = await authSessions.sql(
    'SELECT id FROM "user" WHERE name = $1',
    ['Isolation member'],
  )
  const accountId = (users[0] as { id?: string } | undefined)?.id
  if (!accountId) throw new Error('Signed-in test Account was not persisted')
  const roomId = randomUUID()
  try {
    await authSessions.sql(
      `INSERT INTO room
         (id, name, category, tags, visibility, password_hash, created_by, created_at)
       VALUES ($1, $2, NULL, '{}', 'public', NULL, $3, now())`,
      [roomId, 'Second request room', accountId],
    )

    const second = await signedIn.context.request.get('/')
    expect(await second.text()).toContain('<p>1<!-- --> rooms available.</p>')
  } finally {
    await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
  }
})

test('search keeps prior rooms visible while the canonical key changes', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '102938475610293852',
    username: 'placeholder',
    global_name: 'Placeholder member',
    avatar: 'placeholder-avatar',
    email: 'placeholder@example.test',
    verified: true,
  })
  const users = await authSessions.sql(
    'SELECT id FROM "user" WHERE name = $1',
    ['Placeholder member'],
  )
  const accountId = (users[0] as { id?: string } | undefined)?.id
  if (!accountId) throw new Error('Signed-in test Account was not persisted')
  const roomId = randomUUID()
  try {
    await authSessions.sql(
      `INSERT INTO room
         (id, name, category, tags, visibility, password_hash, created_by, created_at)
       VALUES ($1, $2, NULL, '{}', 'public', NULL, $3, now())`,
      [roomId, 'Alpha gathering', accountId],
    )
    const page = await pageWithQueryHarness(signedIn.context)
    await navigateHome(page, 'alpha')
    await expect(page.getByText('1 rooms available.')).toBeVisible()

    await page.route('**/_serverFn/**', async (route) => {
      const decoded = decodeURIComponent(route.request().url())
      if (decoded.includes('beta')) {
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
      await route.continue()
    })
    const betaRequest = page.waitForRequest((request) =>
      decodeURIComponent(request.url()).includes('beta'),
    )
    await navigateHome(page, 'beta', false)
    await betaRequest
    await expect(page.getByText('Updating room results.')).toBeVisible()
    await expect(page.getByText('1 rooms available.')).toBeVisible()
    await expect(page.getByText('0 rooms available.')).toBeVisible()
    await expect(page.getByText('Updating room results.')).toBeHidden()
  } finally {
    await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
  }
})

test('superseded search navigation cancels its obsolete room query', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '102938475610293853',
    username: 'cancellation',
    global_name: 'Cancellation member',
    avatar: 'cancellation-avatar',
    email: 'cancellation@example.test',
    verified: true,
  })
  const page = await pageWithQueryHarness(signedIn.context)
  const gammaGate = Promise.withResolvers<void>()
  await page.route('**/_serverFn/**', async (route) => {
    if (decodeURIComponent(route.request().url()).includes('gamma')) {
      await gammaGate.promise
    }
    await route.continue().catch(() => undefined)
  })

  const gammaRequest = page.waitForRequest((request) =>
    decodeURIComponent(request.url()).includes('gamma'),
  )
  await navigateHome(page, 'gamma', false)
  await gammaRequest
  await navigateHome(page, 'delta', false)
  await expect(page).toHaveURL(/\?q=delta$/)
  await expect(page.getByText('0 rooms available.')).toBeVisible()

  const obsoleteState = await page.evaluate(() => {
    const roots = (window as TestWindow).__HOME_TEST_REACT_ROOTS__ ?? []
    const pending = roots.map((root) => root.current)
    const seen = new Set<unknown>()
    while (pending.length > 0) {
      const fiber = pending.pop() as
        | {
            child?: unknown
            sibling?: unknown
            memoizedProps?: {
              client?: {
                getQueryCache(): {
                  find(input: {
                    queryKey: readonly unknown[]
                    exact: boolean
                  }):
                    | {
                        state: {
                          data: unknown
                          fetchStatus: string
                        }
                      }
                    | undefined
                }
              }
            }
          }
        | undefined
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      const client = fiber.memoizedProps?.client
      if (client && typeof client.getQueryCache === 'function') {
        const query = client.getQueryCache().find({
          queryKey: ['home', 'rooms', { q: 'gamma' }],
          exact: true,
        })
        return query
          ? {
              hasData: query.state.data !== undefined,
              fetchStatus: query.state.fetchStatus,
            }
          : null
      }
      pending.push(fiber.child, fiber.sibling)
    }
    throw new Error('QueryClient provider was not found')
  })
  expect(obsoleteState).toEqual({ hasData: false, fetchStatus: 'idle' })
  gammaGate.resolve()
})
