import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, gotoHydrated, test } from './fixtures'

const ADMIN = {
  id: '102938475610293900',
  username: 'sanction-admin',
  global_name: 'Sanction Admin',
  avatar: 'admin-avatar',
  email: 'sanction-admin@example.test',
  verified: true,
}
const TARGET = {
  id: '502938475610293904',
  username: 'sanction-target',
  global_name: 'Sanction Target',
  avatar: 'target-avatar',
  email: 'sanction-target@example.test',
  verified: true,
}

async function sessionId(page: Page) {
  const value: unknown = await (await page.request.get('/api/session')).json()
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') {
    throw new TypeError('Expected session')
  }
  return value.id
}

async function applySanction(
  page: Page,
  accountId: string,
  capability: 'streaming' | 'chat' | 'room_creation' | 'all_access',
) {
  const panel = page.locator('.admin-sanctions')
  await panel.getByLabel('Account').selectOption(accountId)
  await panel.getByLabel('Capability').selectOption(capability)
  await panel.getByLabel('Indefinite').check()
  await panel.getByRole('button', { name: 'Apply sanction' }).click()
  await expect(panel.getByRole('status')).toHaveText(
    'Sanction applied. Capability state is now authoritative.',
  )
}

async function liftSanction(page: Page, capabilityLabel: string) {
  const active = page.getByRole('region', { name: 'Active sanctions' })
  const item = active.getByRole('listitem').filter({ hasText: 'Sanction Target' }).filter({
    hasText: capabilityLabel,
  })
  await item.getByRole('button', { name: 'Lift' }).click()
  await item.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.locator('.admin-sanctions').getByRole('status')).toHaveText(
    'Sanction lifted across its enforcement lineage.',
  )
}

test('Admin sanctions update every affected Account capability and remain unavailable to ordinary Accounts', async ({
  authSessions,
}) => {
  const admin = await authSessions.createBrowserContext(ADMIN)
  const target = await authSessions.createBrowserContext(TARGET)
  const adminPage = await admin.context.newPage()
  const targetPage = await target.context.newPage()
  const targetId = await sessionId(targetPage)
  const roomId = randomUUID()
  const membershipId = randomUUID()
  const streamId = randomUUID()

  await authSessions.sql(
    `INSERT INTO room (id, name, tags, visibility, created_at)
     VALUES ($1, 'Sanction controls room', ARRAY[]::text[], 'public', now())`,
    [roomId],
  )
  await authSessions.sql(
    `INSERT INTO room_membership (id, room_id, account_id, role, joined_at)
     VALUES ($1, $2, $3, 'host', now())`,
    [membershipId, roomId, targetId],
  )
  await authSessions.sql(
    `INSERT INTO stream (id, room_id, membership_id, started_at)
     VALUES ($1, $2, $3, now())`,
    [streamId, roomId, membershipId],
  )

  await gotoHydrated(targetPage, '/admin')
  await expect(targetPage.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await gotoHydrated(targetPage, `/rooms/${roomId}`)
  await expect(targetPage.locator('[data-room-state="admitted"]')).toBeVisible()
  await expect(targetPage.getByLabel('Message', { exact: true })).toBeEnabled()

  for (const width of [390, 1024, 1440]) {
    await adminPage.setViewportSize({ width, height: 900 })
    await gotoHydrated(adminPage, '/admin')
    await expect(adminPage.getByRole('heading', { name: 'Platform sanctions' })).toBeVisible()
    await expect(adminPage.getByRole('button', { name: 'Apply sanction' })).toBeVisible()
  }

  await applySanction(adminPage, targetId, 'streaming')
  await expect(targetPage.getByText('Streaming is unavailable on your account.')).toBeVisible()
  await expect(targetPage.getByRole('button', { name: 'Streaming unavailable' })).toBeDisabled()
  await expect(authSessions.sql('SELECT ended_at FROM stream WHERE id = $1', [streamId])).resolves.toEqual([
    { ended_at: expect.any(String) },
  ])
  await liftSanction(adminPage, 'Streaming')
  await expect(targetPage.getByRole('button', { name: 'Streaming unavailable' })).toHaveCount(0)

  await applySanction(adminPage, targetId, 'chat')
  await expect(
    targetPage.getByText('Chat is unavailable on your account. Existing messages remain available.'),
  ).toBeVisible()
  await expect(targetPage.getByLabel('Message', { exact: true })).toBeDisabled()
  await liftSanction(adminPage, 'Chat')
  await expect(targetPage.getByLabel('Message', { exact: true })).toBeEnabled()

  await gotoHydrated(targetPage, '/')
  await applySanction(adminPage, targetId, 'room_creation')
  await targetPage
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const createRoom = targetPage.getByRole('dialog', { name: 'Create Room' })
  await createRoom.getByLabel('Name').fill('Blocked room')
  await createRoom.getByRole('button', { name: 'Create Room' }).click()
  await expect(createRoom.getByRole('alert')).toHaveText('This account cannot create rooms right now.')
  await liftSanction(adminPage, 'Room creation')

  await gotoHydrated(targetPage, `/rooms/${roomId}`)
  await expect(targetPage.locator('[data-room-state="admitted"]')).toBeVisible()
  await expect(targetPage.getByLabel('Message', { exact: true })).toBeEnabled()
  await applySanction(adminPage, targetId, 'all_access')
  await expect(targetPage.locator('[data-room-state="pre-admission"]')).toBeVisible()
  await expect(targetPage.locator('[data-room-state="admitted"]')).toHaveCount(0)
  await expect(
    authSessions.sql(
      'SELECT count(*)::int AS count FROM room_membership WHERE account_id = $1 AND left_at IS NULL',
      [targetId],
    ),
  ).resolves.toEqual([{ count: 0 }])
})
