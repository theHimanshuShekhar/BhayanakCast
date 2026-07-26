import { expect, test } from './fixtures'

const VIEWER = {
  id: '102938475610293847',
  username: 'mute-viewer',
  global_name: 'Mute viewer',
  avatar: null,
  email: 'mute-viewer@example.test',
  verified: true,
}

const TARGET = {
  id: '918273645091827364',
  username: 'mute-target',
  global_name: 'Mute target',
  avatar: null,
  email: 'mute-target@example.test',
  verified: true,
}

test('Profile lists only the viewer mutes and unmute restores the empty state', async ({
  authSessions,
}) => {
  const target = await authSessions.createBrowserContext(TARGET)
  const targetPage = await target.context.newPage()
  await targetPage.goto(`${authSessions.origin}/profile`)
  const targetSession = await (await targetPage.request.get(`${authSessions.origin}/api/session`)).json()

  const viewer = await authSessions.createBrowserContext(VIEWER)
  const page = await viewer.context.newPage()
  await page.goto(`${authSessions.origin}/profile`)
  const viewerSession = await (await page.request.get(`${authSessions.origin}/api/session`)).json()
  await authSessions.sql(
    `INSERT INTO chat_mute (muting_account_id, muted_account_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [viewerSession.id, targetSession.id],
  )
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Muted accounts' })).toBeVisible()
  await expect(page.getByText('Mute target', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unmute Mute target' })).toBeVisible()

  const other = await authSessions.createBrowserContext({
    ...TARGET,
    id: '564738291056473829',
    username: 'mute-other-viewer',
    global_name: 'Other mute viewer',
    email: 'mute-other-viewer@example.test',
  })
  const otherPage = await other.context.newPage()
  await otherPage.goto(`${authSessions.origin}/profile`)
  await expect(otherPage.getByText('No accounts are muted.')).toBeVisible()
  await expect(otherPage.getByText('Mute target', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Unmute Mute target' }).click()
  await expect(page.getByText('No accounts are muted.')).toBeVisible()
  await expect
    .poll(async () => {
      const rows = await authSessions.sql(
        'SELECT count(*)::int AS count FROM chat_mute WHERE muting_account_id = $1',
        [viewerSession.id],
      )
      return (rows[0] as { count?: number } | undefined)?.count ?? -1
    })
    .toBe(0)
})

test('deleted targets reveal no identity in the Profile mute list', async ({ authSessions }) => {
  const target = await authSessions.createBrowserContext(TARGET)
  const targetPage = await target.context.newPage()
  await targetPage.goto(`${authSessions.origin}/profile`)
  const targetSession = await (await targetPage.request.get(`${authSessions.origin}/api/session`)).json()

  const viewer = await authSessions.createBrowserContext(VIEWER)
  const page = await viewer.context.newPage()
  await page.goto(`${authSessions.origin}/profile`)
  const viewerSession = await (await page.request.get(`${authSessions.origin}/api/session`)).json()
  await authSessions.sql(
    `INSERT INTO chat_mute (muting_account_id, muted_account_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [viewerSession.id, targetSession.id],
  )
  await authSessions.sql(
    `INSERT INTO account_state (account_id, deletion_requested_at)
     VALUES ($1, now())
     ON CONFLICT (account_id) DO UPDATE SET deletion_requested_at = EXCLUDED.deletion_requested_at`,
    [targetSession.id],
  )
  await page.reload()

  await expect(page.getByText('No accounts are muted.')).toBeVisible()
  await expect(page.getByText('Mute target', { exact: true })).toHaveCount(0)
})

test('unmute reports errors and keeps the optimistic list rollback', async ({ authSessions }) => {
  const target = await authSessions.createBrowserContext(TARGET)
  const targetPage = await target.context.newPage()
  await targetPage.goto(`${authSessions.origin}/profile`)
  const targetSession = await (await targetPage.request.get(`${authSessions.origin}/api/session`)).json()

  const viewer = await authSessions.createBrowserContext(VIEWER)
  const page = await viewer.context.newPage()
  await page.goto(`${authSessions.origin}/profile`)
  const viewerSession = await (await page.request.get(`${authSessions.origin}/api/session`)).json()
  await authSessions.sql(
    `INSERT INTO chat_mute (muting_account_id, muted_account_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [viewerSession.id, targetSession.id],
  )
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({ status: 500, body: 'unmute unavailable' })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Unmute Mute target' }).click()

  await expect(page.getByText('Mute target', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('could not be unmuted')
})

test('failed unmute reconciles with the server mute list after rollback', async ({
  authSessions,
}) => {
  const target = await authSessions.createBrowserContext(TARGET)
  const targetPage = await target.context.newPage()
  await targetPage.goto(`${authSessions.origin}/profile`)
  const targetSession = await (await targetPage.request.get(`${authSessions.origin}/api/session`)).json()

  const viewer = await authSessions.createBrowserContext(VIEWER)
  const page = await viewer.context.newPage()
  await page.goto(`${authSessions.origin}/profile`)
  const viewerSession = await (await page.request.get(`${authSessions.origin}/api/session`)).json()
  await authSessions.sql(
    `INSERT INTO chat_mute (muting_account_id, muted_account_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [viewerSession.id, targetSession.id],
  )
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await authSessions.sql(
      'DELETE FROM chat_mute WHERE muting_account_id = $1 AND muted_account_id = $2',
      [viewerSession.id, targetSession.id],
    )
    await route.fulfill({ status: 500, body: 'unmute unavailable' })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Unmute Mute target' }).click()

  await expect(page.getByRole('alert')).toContainText('could not be unmuted')
  await expect(page.getByText('No accounts are muted.')).toBeVisible()
})

test('unmute keeps keyboard focus and announces the successful change', async ({
  authSessions,
}) => {
  const target = await authSessions.createBrowserContext(TARGET)
  const targetPage = await target.context.newPage()
  await targetPage.goto(`${authSessions.origin}/profile`)
  const targetSession = await (await targetPage.request.get(`${authSessions.origin}/api/session`)).json()

  const viewer = await authSessions.createBrowserContext(VIEWER)
  const page = await viewer.context.newPage()
  await page.goto(`${authSessions.origin}/profile`)
  const viewerSession = await (await page.request.get(`${authSessions.origin}/api/session`)).json()
  await authSessions.sql(
    `INSERT INTO chat_mute (muting_account_id, muted_account_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [viewerSession.id, targetSession.id],
  )
  await page.reload()
  await page.getByRole('button', { name: 'Unmute Mute target' }).click()

  await expect(page.getByRole('heading', { name: 'Muted accounts' })).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Unmuted Mute target.')
})
