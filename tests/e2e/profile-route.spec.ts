import { randomUUID } from 'node:crypto'
import { expect, test } from './fixtures'

async function seedPastActivity(
  sql: (text: string, values?: unknown[]) => Promise<unknown[]>,
  accountId: string,
) {
  const roomId = randomUUID()
  const membershipId = randomUUID()
  const endedAt = '2026-07-15T15:00:00.000Z'
  await sql(
    `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_at, ended_at)
     VALUES ($1, 'Current member room', 'Film', ARRAY['classic'], 'public', NULL, $2, $2)`,
    [roomId, '2026-07-15T14:00:00.000Z'],
  )
  await sql(
    `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
     VALUES ($1, $2, $3, 'member', $4, $5)`,
    [membershipId, roomId, accountId, '2026-07-15T14:00:00.000Z', endedAt],
  )
  return async () => {
    await sql('DELETE FROM room_membership WHERE id = $1', [membershipId])
    await sql('DELETE FROM room WHERE id = $1', [roomId])
  }
}

test('anonymous direct Profile navigation shows a noindex Discord access gate', async ({
  authSessions,
  page,
}) => {
  await page.goto(`${authSessions.origin}/profile`)

  await expect(page).toHaveURL(`${authSessions.origin}/profile`)
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  await expect(
    page.getByText('Sign in to see your public activity and account details.', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Continue with Discord', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Public activity' })).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/i,
  )
})

test('authenticated Profile shows only the current Account public projection', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '102938475610293847',
    username: 'current-member',
    global_name: 'Current member',
    avatar: 'current-avatar',
    email: 'private@example.test',
    verified: true,
  })
  const page = await signedIn.context.newPage()
  const session = await (await page.request.get(`${authSessions.origin}/api/session`)).json()
  const cleanupPastActivity = await seedPastActivity(authSessions.sql, session.id)

  try {
    await page.goto(`${authSessions.origin}/profile`)

    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Current member', exact: true })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Current member', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Public activity' })).toBeVisible()
    await expect(page.getByText('Current member room', { exact: true })).toBeVisible()
    await expect(page.getByText('private@example.test', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Preferences', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Account deletion', exact: true })).toHaveCount(0)
    await expect(page.getByText(/will be available in a later update/i)).toHaveCount(0)
  } finally {
    await cleanupPastActivity()
  }
})

test('invalid Profile session falls back to the anonymous access gate', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '918273645091827364',
    username: 'revoked-member',
    global_name: 'Revoked member',
    avatar: null,
  })
  const page = await signedIn.context.newPage()
  await page.goto(`${authSessions.origin}/profile`)
  await expect(page.getByRole('heading', { name: 'Revoked member', exact: true })).toBeVisible()

  await signedIn.context.clearCookies()
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Revoked member', exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Continue with Discord', exact: true }),
  ).toBeVisible()
})

test('public user profiles do not render Profile private sections', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '564738291056473829',
    username: 'public-member',
    global_name: 'Public member',
    avatar: null,
    email: 'not-public@example.test',
  })
  const page = await signedIn.context.newPage()
  const session = await (await page.request.get(`${authSessions.origin}/api/session`)).json()

  await page.goto(`${authSessions.origin}/users/${encodeURIComponent(session.id)}`)

  await expect(page.getByRole('heading', { name: 'Public member', exact: true })).toBeVisible()
  await expect(page.getByText('not-public@example.test', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Preferences' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Account deletion' })).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
})
