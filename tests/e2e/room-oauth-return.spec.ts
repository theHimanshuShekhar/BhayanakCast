import { randomUUID } from 'node:crypto'
import { expect, test } from './fixtures'

const OWNER = {
  id: '102938475610293855',
  username: 'task11-oauth-owner',
  global_name: 'OAuth Owner',
  avatar: 'task11-oauth-owner-avatar',
  email: 'task11-oauth-owner@example.test',
  verified: true,
}

const RETURN_PROFILE = {
  id: '102938475610293856',
  username: 'task11-oauth-return',
  global_name: 'OAuth Return',
  avatar: 'task11-oauth-return-avatar',
  email: 'task11-oauth-return@example.test',
  verified: true,
}

test('authenticated OAuth return opens a blank create intent without joining a room', async ({ authSessions }) => {
  const signedIn = await authSessions.createBrowserContext(OWNER)
  const page = await signedIn.context.newPage()
  await page.goto('/?intent=create')
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Name')).toHaveValue('')
  await expect(dialog.getByLabel('Category')).toHaveValue('')
  await expect(dialog.getByLabel(/Tags/)).toHaveValue('')
})

test('anonymous Create keeps its label and starts a create-only OAuth callback', async ({ authSessions, browser }) => {
  const context = await browser.newContext({ baseURL: authSessions.origin })
  const page = await context.newPage()
  let callbackURL = ''
  await page.route('**/api/auth/sign-in/social', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { callbackURL?: string }
    callbackURL = body.callbackURL ?? ''
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/oauth/mock' }) })
  })
  await page.goto('/')
  const createButton = page.getByTestId('home-bottom-navigation').getByRole('button', { name: 'Create room' })
  await expect(createButton).toBeVisible()
  await createButton.click()
  await expect.poll(() => callbackURL).toBe('/?intent=create')
  await expect(page.getByRole('dialog', { name: 'Create Room' })).toHaveCount(0)
  await context.close()
})

test('missing room is HTTP 404 and ended room is Past Stream without Join', async ({ authSessions, browser }) => {
  const accountId = randomUUID()
  const endedRoomId = randomUUID()
  await authSessions.sql(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Ended owner', $2, false, now(), now())`,
    [accountId, `${accountId}@example.test`],
  )
  await authSessions.sql(
    `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_by, created_at, ended_at)
     VALUES ($1, 'Ended boundary room', NULL, ARRAY[]::text[], 'public', NULL, $2, now(), now())`,
    [endedRoomId, accountId],
  )
  const context = await browser.newContext({ baseURL: authSessions.origin })
  const page = await context.newPage()
  const missingResponse = await page.goto(`${authSessions.origin}/rooms/${randomUUID()}`)
  expect(missingResponse?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Room not found' })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await page.goto(`${authSessions.origin}/rooms/${endedRoomId}`)
  await expect(page.getByText('Past Stream', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join' })).toHaveCount(0)
  await context.close()
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [endedRoomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [endedRoomId])
  await authSessions.sql('DELETE FROM "user" WHERE id = $1', [accountId])
})

test('anonymous private Join OAuth carries only the opaque room path', async ({ authSessions, browser }) => {
  const roomId = randomUUID()
  const accountId = randomUUID()
  await authSessions.sql(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'OAuth owner', $2, false, now(), now())`,
    [accountId, `${accountId}@example.test`],
  )
  await authSessions.sql(
    `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_by, created_at)
     VALUES ($1, 'Private OAuth room', 'Games', ARRAY['private'], 'private', 'not-a-real-hash', $2, now())`,
    [roomId, accountId],
  )
  const roomUrl = `${authSessions.origin}/rooms/${roomId}`

  const anonymous = await browser.newContext({ baseURL: authSessions.origin })
  const page = await anonymous.newPage()
  let callbackURL = ''
  await page.route('**/api/auth/sign-in/social', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { callbackURL?: string }
    callbackURL = body.callbackURL ?? ''
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/oauth/mock' }) })
  })
  await page.goto(roomUrl)
  await expect(page.getByRole('button', { name: 'Join' })).toBeVisible()
  await expect(page.getByLabel('Password')).toHaveCount(0)
  await page.getByRole('button', { name: 'Join' }).click()
  await expect.poll(() => callbackURL).toContain('/rooms/')
  expect(callbackURL).not.toContain('password')
  expect(callbackURL).not.toContain('private')
  await anonymous.close()
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
  await authSessions.sql('DELETE FROM "user" WHERE id = $1', [accountId])
})

test('OAuth return re-evaluates private, full, ended, and missing targets without admission', async ({ authSessions, browser }) => {
  const ownerId = randomUUID()
  const privateRoomId = randomUUID()
  const fullRoomId = randomUUID()
  const endedRoomId = randomUUID()
  const missingRoomId = randomUUID()
  const syntheticAccounts = Array.from({ length: 10 }, () => randomUUID())
  await authSessions.sql(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'OAuth return owner', $2, false, now(), now())`,
    [ownerId, `${ownerId}@example.test`],
  )
  for (const [roomId, name] of [
    [privateRoomId, 'OAuth private target'],
    [fullRoomId, 'OAuth full target'],
    [endedRoomId, 'OAuth ended target'],
    [missingRoomId, 'OAuth missing target'],
  ] as const) {
    await authSessions.sql(
      `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_by, created_at)
       VALUES ($1, $2, NULL, ARRAY[]::text[], 'public', NULL, $3, now())`,
      [roomId, name, ownerId],
    )
  }

  const anonymous = await browser.newContext({ baseURL: authSessions.origin })
  const anonymousPage = await anonymous.newPage()
  let callbackURL = ''
  await anonymousPage.route('**/api/auth/sign-in/social', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { callbackURL?: string }
    callbackURL = body.callbackURL ?? ''
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: '/oauth/mock' }),
    })
  })

  for (const roomId of [privateRoomId, fullRoomId, endedRoomId, missingRoomId]) {
    callbackURL = ''
    await anonymousPage.goto(`${authSessions.origin}/rooms/${roomId}`)
    await anonymousPage.getByRole('button', { name: 'Join' }).click()
    await expect.poll(() => callbackURL).toContain(`/rooms/${roomId}`)
    expect(callbackURL).not.toContain('password')
  }

  for (const accountId of syntheticAccounts) {
    await authSessions.sql(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ($1, 'OAuth full member', $2, false, now(), now())`,
      [accountId, `${accountId}@example.test`],
    )
    await authSessions.sql(
      `INSERT INTO room_membership (id, room_id, account_id, role, joined_at)
       VALUES ($1, $2, $3, 'member', now())`,
      [randomUUID(), fullRoomId, accountId],
    )
  }
  await authSessions.sql(
    `UPDATE room
        SET visibility = 'private', password_hash = 'not-a-real-hash'
      WHERE id = $1`,
    [privateRoomId],
  )
  await authSessions.sql('UPDATE room SET ended_at = now() WHERE id = $1', [endedRoomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [missingRoomId])

  const returnSession = await authSessions.createBrowserContext(RETURN_PROFILE)
  const returnPage = await returnSession.context.newPage()
  await returnPage.goto(`${authSessions.origin}/rooms/${privateRoomId}`)
  await expect(returnPage.locator('[data-room-state="pre-admission"]')).toBeVisible()
  await expect(returnPage.getByLabel('Password')).toBeVisible()
  await expect(returnPage.getByRole('button', { name: 'Join' })).toBeEnabled()

  await returnPage.goto(`${authSessions.origin}/rooms/${fullRoomId}`)
  await expect(returnPage.getByRole('button', { name: 'Full' })).toBeDisabled()
  await expect(returnPage.locator('[data-room-state="pre-admission"]')).toBeVisible()

  await returnPage.goto(`${authSessions.origin}/rooms/${endedRoomId}`)
  await expect(returnPage.getByText('Past Stream', { exact: true })).toBeVisible()
  await expect(returnPage.getByRole('button', { name: 'Join' })).toHaveCount(0)

  const missingResponse = await returnPage.goto(`${authSessions.origin}/rooms/${missingRoomId}`)
  expect(missingResponse?.status()).toBe(404)
  await expect(returnPage.getByRole('heading', { name: 'Room not found' })).toBeVisible()
  const returnAccount = (await authSessions.sql(
    'SELECT id FROM "user" WHERE email = $1',
    [RETURN_PROFILE.email],
  ) as { id: string }[])[0]?.id
  expect(returnAccount).toBeTruthy()
  const memberships = await authSessions.sql(
    'SELECT room_id AS "roomId" FROM room_membership WHERE account_id = $1 AND left_at IS NULL',
    [returnAccount],
  )
  expect(memberships).toHaveLength(0)

  await anonymous.close()
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = ANY($1::uuid[])', [[privateRoomId, fullRoomId, endedRoomId]])
  await authSessions.sql('DELETE FROM room WHERE id = ANY($1::uuid[])', [[privateRoomId, fullRoomId, endedRoomId]])
  for (const accountId of syntheticAccounts) {
    await authSessions.sql('DELETE FROM "user" WHERE id = $1', [accountId])
  }
  await authSessions.sql('DELETE FROM "user" WHERE id = $1', [ownerId])
})
