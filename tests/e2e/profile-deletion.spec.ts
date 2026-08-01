import { randomUUID } from 'node:crypto'
import { io } from 'socket.io-client'
import { expect, test } from './fixtures'

const PROFILE = {
  id: '564738291056473829',
  username: 'deletion-member',
  global_name: 'Deletion member',
  avatar: null,
  email: 'deletion-member@example.test',
  verified: true,
} as const

async function seedPastActivity(
  sql: (text: string, values?: unknown[]) => Promise<unknown[]>,
  accountId: string,
) {
  const roomId = randomUUID()
  const membershipId = randomUUID()
  await sql(
    `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_at, ended_at)
     VALUES ($1, 'Deletion history room', 'Film', ARRAY['classic'], 'public', NULL, $2, $3)`,
    [roomId, '2026-07-15T14:00:00.000Z', '2026-07-15T15:00:00.000Z'],
  )
  await sql(
    `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
     VALUES ($1, $2, $3, 'member', $4, $5)`,
    [
      membershipId,
      roomId,
      accountId,
      '2026-07-15T14:00:00.000Z',
      '2026-07-15T15:00:00.000Z',
    ],
  )
  return async () => {
    await sql('DELETE FROM room_membership WHERE id = $1', [membershipId])
    await sql('DELETE FROM room WHERE id = $1', [roomId])
  }
}
test('account deletion uses explicit native confirmation and supports pending cancellation', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '564738291056473829',
    username: 'deletion-member',
    global_name: 'Deletion member',
    avatar: null,
    email: 'deletion-member@example.test',
    verified: true,
  })
  const page = await signedIn.context.newPage()

  await page.goto(`${authSessions.origin}/profile`)
  await expect(page.getByRole('heading', { name: 'Account deletion' })).toBeVisible()
  await page.getByRole('button', { name: 'Request account deletion' }).click()

  const dialog = page.getByRole('dialog', { name: 'Request account deletion' })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByText(/public profile, statistics, past rooms/i),
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Keep my account' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Request account deletion' })).toBeFocused()

  await page.getByRole('button', { name: 'Request account deletion' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Request deletion now' }).click()
  const deletionSection = page.getByRole('region', { name: 'Account deletion' })
  await expect(deletionSection.getByRole('status')).toContainText(
    'Deletion request pending',
  )
  const socket = io(authSessions.origin, {
    path: '/socket.io/',
    transports: ['websocket'],
    autoConnect: false,
    extraHeaders: { cookie: signedIn.sessionCookie },
  })
  const rejected = Promise.withResolvers<Error>()
  socket.once('connect_error', rejected.resolve)
  socket.connect()
  await expect(rejected.promise).resolves.toMatchObject({
    message: 'Account access restricted',
  })
  socket.disconnect()
  await expect(page.getByRole('heading', { name: 'Theme preference' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Muted accounts' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Cancel deletion request' }).click()
  await expect(page.getByText('Your account is active again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Request account deletion' })).toBeVisible()

  await signedIn.context.close()
})

test('pending deletion forcibly disconnects an already connected socket', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const page = await signedIn.context.newPage()
  const socket = io(authSessions.origin, {
    path: '/socket.io/',
    transports: ['websocket'],
    autoConnect: false,
    extraHeaders: { cookie: signedIn.sessionCookie },
  })
  const connected = Promise.withResolvers<void>()
  const disconnected = Promise.withResolvers<string>()
  socket.once('connect', connected.resolve)
  socket.once('disconnect', disconnected.resolve)

  try {
    await page.goto(`${authSessions.origin}/profile`)
    socket.connect()
    await expect(connected.promise).resolves.toBeUndefined()
    await page.getByRole('button', { name: 'Request account deletion' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Request deletion now' }).click()
    await expect(page.getByRole('region', { name: 'Account deletion' }).getByRole('status')).toContainText('Deletion request pending')
    await expect(disconnected.promise).resolves.toBe('io server disconnect')
    expect(socket.connected).toBe(false)
  } finally {
    socket.disconnect()
    await signedIn.context.close()
  }
})
test('pending deletion hides and cancellation restores public projections across contexts', async ({
  authSessions,
  browser,
}) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const pageA = await signedIn.context.newPage()
  const publicContext = await browser.newContext({ baseURL: authSessions.origin })
  const pageB = await publicContext.newPage()
  const session = await (await pageA.request.get(`${authSessions.origin}/api/session`)).json() as {
    id: string
  }
  const cleanupActivity = await seedPastActivity(authSessions.sql, session.id)

  try {
    await pageB.goto(`${authSessions.origin}/users/${session.id}`)
    await expect(pageB.getByRole('heading', { name: 'Deletion member' })).toBeVisible()
    await expect(pageB.getByText('1 room', { exact: true })).toBeVisible()
    await pageB.goto(`${authSessions.origin}/?q=Deletion%20member`)
    await expect(
      pageB.getByRole('link', { name: 'Open Deletion member public profile' }),
    ).toBeVisible()

    await pageA.goto(`${authSessions.origin}/profile`)
    const deletionTrigger = pageA.getByRole('button', { name: 'Request account deletion' })
    const deletionDialog = pageA.getByRole('dialog')
    await expect(async () => {
      await deletionTrigger.click()
      await expect(deletionDialog).toBeVisible()
    }).toPass({ timeout: 15_000 })
    await deletionDialog.getByRole('button', { name: 'Request deletion now' }).click()
    await expect(pageA.getByRole('region', { name: 'Account deletion' }).getByRole('status')).toContainText('Deletion request pending')

    await pageB.goto(`${authSessions.origin}/users/${session.id}`)
    await pageB.reload()
    await expect(pageB.getByRole('heading', { name: 'Profile not found' })).toBeVisible()
    await pageB.goto(`${authSessions.origin}/?q=Deletion%20member`)
    await expect(
      pageB.getByRole('link', { name: 'Open Deletion member public profile' }),
    ).toHaveCount(0)
    await expect(pageB.getByText('No public profiles match this search.')).toBeVisible()

    await pageA.getByRole('button', { name: 'Cancel deletion request' }).click()
    await expect(pageA.getByText('Your account is active again.')).toBeVisible()
    await pageB.goto(`${authSessions.origin}/users/${session.id}`)
    await pageB.reload()
    await expect(pageB.getByRole('heading', { name: 'Deletion member' })).toBeVisible()
    await expect(pageB.getByText('1 room', { exact: true })).toBeVisible()
    await pageB.goto(`${authSessions.origin}/?q=Deletion%20member`)
    await expect(
      pageB.getByRole('link', { name: 'Open Deletion member public profile' }),
    ).toBeVisible()
  } finally {
    await cleanupActivity()
    await publicContext.close()
    await signedIn.context.close()
  }
})

test('denies a real authenticated theme mutation while deletion is pending', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const page = await signedIn.context.newPage()
  let capture!: (value: { url: string; body: string; contentType: string }) => void
  const captured = new Promise<{ url: string; body: string; contentType: string }>((resolve) => {
    capture = resolve
  })
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const request = route.request()
    const body = request.postData()
    if (!body) throw new Error('Theme mutation request had no body')
    capture({
      url: request.url(),
      body,
      contentType: request.headers()['content-type'] ?? 'application/json',
    })
    await route.abort()
  })

  try {
    await page.goto(`${authSessions.origin}/profile`)
    await page.getByRole('combobox', { name: 'Theme preference' }).selectOption('dark')
    const request = await captured
    await page.unroute('**/_serverFn/**')
    await expect(page.getByRole('combobox', { name: 'Theme preference' })).toHaveValue('system')

    await page.getByRole('button', { name: 'Request account deletion' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Request deletion now' }).click()
    await expect(page.getByRole('region', { name: 'Account deletion' }).getByRole('status')).toContainText('Deletion request pending')

    const replay = await page.evaluate(
      async ({ url, body, contentType }) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': contentType },
          body,
        })
        return { status: response.status }
      },
      request,
    )
    expect(replay.status).toBeGreaterThanOrEqual(400)
    await expect(
      authSessions.sql(
        `SELECT 1 FROM account_preference
         WHERE account_id = (SELECT id FROM "user" WHERE email = $1)`,
        [PROFILE.email],
      ),
    ).resolves.toEqual([])
  } finally {
    await page.unroute('**/_serverFn/**').catch(() => undefined)
    await signedIn.context.close()
  }
})

test('service approval invalidates the real Better Auth browser session', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const page = await signedIn.context.newPage()
  try {
    await page.goto(`${authSessions.origin}/profile`)
    const session = await (await page.request.get(`${authSessions.origin}/api/session`)).json() as {
      id: string
    }
    await page.getByRole('button', { name: 'Request account deletion' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Request deletion now' }).click()
    await expect(page.getByRole('region', { name: 'Account deletion' }).getByRole('status')).toContainText('Deletion request pending')

    await authSessions.respondToDeletion(session.id, 'approved')
    await page.reload()
    await expect(
      page.getByText('Sign in to see your public activity and account details.'),
    ).toBeVisible()
    await expect.poll(async () => (await page.request.get(`${authSessions.origin}/api/session`)).json())
      .toBeNull()
  } finally {
    await signedIn.context.close()
  }
})

test('Escape cannot hide a busy deletion confirmation or its error', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const page = await signedIn.context.newPage()
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await held
    try {
      await route.fulfill({ status: 500, body: 'deletion unavailable' })
    } catch {
      // The current dialog may abort the request when Escape closes it.
    }
  })

  try {
    await page.goto(`${authSessions.origin}/profile`)
    await page.getByRole('button', { name: 'Request account deletion' }).click()
    const dialog = page.getByRole('dialog', { name: 'Request account deletion' })
    await dialog.getByRole('button', { name: 'Request deletion now' }).click()
    await expect(
      dialog.getByRole('button', { name: 'Submitting deletion request…' }),
    ).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

    release()
    await expect(dialog.getByRole('alert')).toContainText('Unable to submit this request.')
    await expect(dialog).toBeVisible()
  } finally {
    release()
    await page.unroute('**/_serverFn/**').catch(() => undefined)
    await signedIn.context.close()
  }
})

test('external rejection restores pending profile controls in place', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const page = await signedIn.context.newPage()
  try {
    await page.goto(`${authSessions.origin}/profile`)
    const session = await (await page.request.get(`${authSessions.origin}/api/session`)).json() as {
      id: string
    }
    await page.getByRole('button', { name: 'Request account deletion' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Request deletion now' }).click()
    await expect(page.getByRole('region', { name: 'Account deletion' }).getByRole('status')).toContainText('Deletion request pending')
    await expect(page.getByRole('heading', { name: 'Theme preference' })).toHaveCount(0)

    await authSessions.respondToDeletion(session.id, 'rejected')

    await expect(page.getByText('Your account is active again.')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Request account deletion' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Theme preference' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Muted accounts' })).toBeVisible()
  } finally {
    await signedIn.context.close()
  }
})

test('Platform Admin rejects or irreversibly approves a pending deletion from the private queue', async ({
  authSessions,
}) => {
  const member = await authSessions.createBrowserContext(PROFILE)
  const admin = await authSessions.createBrowserContext({
    id: '102938475610293900',
    username: 'deletion-admin',
    global_name: 'Deletion Admin',
    avatar: null,
    email: 'deletion-admin@example.test',
    verified: true,
  })
  const memberPage = await member.context.newPage()
  const adminPage = await admin.context.newPage()
  try {
    await memberPage.goto(`${authSessions.origin}/profile`)
    await memberPage.getByRole('button', { name: 'Request account deletion' }).click()
    await memberPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Request deletion now' })
      .click()
    await expect(memberPage.getByText(/Deletion request pending/)).toBeVisible()

    await adminPage.goto(`${authSessions.origin}/admin`)
    const review = adminPage.getByRole('listitem').filter({ hasText: 'Deletion member' })
    await review.getByRole('button', { name: 'Reject' }).click()
    await review.getByRole('button', { name: 'Confirm rejection' }).click()
    await expect(review).toHaveCount(0)

    await memberPage.reload()
    await expect(memberPage.getByRole('button', { name: 'Request account deletion' })).toBeVisible()
    await memberPage.getByRole('button', { name: 'Request account deletion' }).click()
    await memberPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Request deletion now' })
      .click()
    await expect(memberPage.getByText(/Deletion request pending/)).toBeVisible()

    await adminPage.reload()
    const resubmitted = adminPage.getByRole('listitem').filter({ hasText: 'Deletion member' })
    await resubmitted.getByRole('button', { name: 'Approve' }).click()
    await resubmitted.getByRole('button', { name: 'Confirm permanent deletion' }).click()
    await expect(resubmitted).toHaveCount(0)

    await memberPage.reload()
    await expect(
      memberPage.getByText('Sign in to see your public activity and account details.'),
    ).toBeVisible()
  } finally {
    await Promise.all([member.context.close(), admin.context.close()])
  }
})
