import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { AuthSessionFixture } from './fixtures'

const ORIGINAL_HOST = {
  id: '812345678901234571',
  username: 'original-host',
  global_name: 'Original Host',
  avatar: 'original-host-avatar',
  email: 'original-host@example.test',
  verified: true,
}

const NEW_HOST = {
  id: '812345678901234572',
  username: 'new-host',
  global_name: 'New Host',
  avatar: 'new-host-avatar',
  email: 'new-host@example.test',
  verified: true,
}

async function createRoom(page: Page) {
  await page.goto('/')
  await page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill('Host transfer room')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  return new URL(page.url()).pathname.split('/').at(-1) as string
}

async function sessionId(page: Page) {
  const value: unknown = await (await page.request.get('/api/session')).json()
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string'
  ) {
    throw new TypeError('Expected session')
  }
  return value.id
}

async function removeRoom(authSessions: AuthSessionFixture, roomId: string) {
  await authSessions.sql(
    'DELETE FROM stream_subscription WHERE stream_id IN (SELECT id FROM stream WHERE room_id = $1)',
    [roomId],
  )
  await authSessions.sql('DELETE FROM stream WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
}

test('Host transfer names the authority consequence and immediately preserves admission and media', async ({
  authSessions,
}) => {
  const originalHost = await authSessions.createBrowserContext(ORIGINAL_HOST)
  const newHost = await authSessions.createBrowserContext(NEW_HOST)
  const originalHostPage = await originalHost.context.newPage()
  const newHostPage = await newHost.context.newPage()
  await originalHostPage.setViewportSize({ width: 1280, height: 800 })
  await newHostPage.setViewportSize({ width: 1280, height: 800 })
  const roomId = await createRoom(originalHostPage)

  try {
    await newHostPage.goto(`/rooms/${roomId}`)
    await newHostPage.getByRole('button', { name: 'Join' }).click()
    await expect(newHostPage.locator('[data-room-state="admitted"]')).toBeVisible()
    const [originalHostId, newHostId] = await Promise.all([
      sessionId(originalHostPage),
      sessionId(newHostPage),
    ])

    const memberships = (await authSessions.sql(
      `SELECT id, account_id AS "accountId"
         FROM room_membership
        WHERE room_id = $1 AND left_at IS NULL`,
      [roomId],
    )) as { id: string; accountId: string }[]
    const membershipId = (accountId: string) => {
      const id = memberships.find((membership) => membership.accountId === accountId)?.id
      if (!id) throw new Error(`Missing membership for ${accountId}`)
      return id
    }
    const streamId = randomUUID()
    const subscriptionId = randomUUID()
    await Promise.all([originalHostPage.reload(), newHostPage.reload()])
    await authSessions.sql(
      `INSERT INTO stream (id, room_id, membership_id, preview_key, preview_updated_at, started_at)
       VALUES ($1, $2, $3, 'host-transfer-preview', now(), now())`,
      [streamId, roomId, membershipId(newHostId)],
    )
    await authSessions.sql(
      `INSERT INTO stream_subscription (id, viewer_membership_id, stream_id, started_at)
       VALUES ($1, $2, $3, now())`,
      [subscriptionId, membershipId(originalHostId), streamId],
    )

    const memberMenuTrigger = newHostPage.getByRole('button', {
      name: 'Actions for Original Host',
    })
    await memberMenuTrigger.press('ArrowDown')
    await expect(
      newHostPage
        .getByRole('menu', { name: 'Actions for Original Host' })
        .getByRole('menuitem', { name: 'Transfer Host…' }),
    ).toHaveCount(0)

    const hostMenuTrigger = originalHostPage.getByRole('button', {
      name: 'Actions for New Host',
    })
    await hostMenuTrigger.press('ArrowDown')
    await originalHostPage
      .getByRole('menu', { name: 'Actions for New Host' })
      .getByRole('menuitem', { name: 'Transfer Host…' })
      .click()

    const confirmation = originalHostPage.getByRole('dialog', {
      name: 'Transfer Host to New Host?',
    })
    await expect(confirmation).toContainText(
      'You will immediately lose Host controls, and New Host will gain them.',
    )
    await expect(confirmation).toContainText(
      'Everyone stays in the room and current Streams and watches continue.',
    )
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(
      originalHostPage.getByRole('button', { name: 'Settings', exact: true }),
    ).toBeVisible()
    await expect(
      newHostPage.getByRole('button', { name: 'Settings', exact: true }),
    ).toHaveCount(0)
    await hostMenuTrigger.press('ArrowDown')
    await originalHostPage
      .getByRole('menu', { name: 'Actions for New Host' })
      .getByRole('menuitem', { name: 'Transfer Host…' })
      .click()
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Transfer Host' }).click()

    await expect(originalHostPage.locator('[data-room-state="admitted"]')).toBeVisible()
    await expect(newHostPage.locator('[data-room-state="admitted"]')).toBeVisible()
    await expect(originalHostPage).toHaveURL(new RegExp(`/rooms/${roomId}$`))
    await expect(newHostPage).toHaveURL(new RegExp(`/rooms/${roomId}$`))
    await expect(
      originalHostPage.getByRole('button', { name: 'Settings', exact: true }),
    ).toHaveCount(0)
    await expect(
      newHostPage.getByRole('button', { name: 'Settings', exact: true }),
    ).toBeVisible()

    await newHostPage
      .getByRole('button', { name: 'Actions for Original Host' })
      .press('ArrowDown')
    await expect(
      newHostPage
        .getByRole('menu', { name: 'Actions for Original Host' })
        .getByRole('menuitem', { name: 'Transfer Host…' }),
    ).toBeVisible()
    await newHostPage.keyboard.press('Escape')

    await newHostPage.getByRole('tab', { name: 'Activity' }).click()
    await expect(newHostPage.getByText('New Host is now the Host.')).toBeVisible()
    await expect(originalHostPage.getByText('1 Stream', { exact: true })).toBeVisible()
    await expect(newHostPage.getByText('1 Stream', { exact: true })).toBeVisible()

    const preserved = (await authSessions.sql(
      `SELECT
         (SELECT count(*)::int FROM room_membership WHERE room_id = $1 AND left_at IS NULL) AS "memberCount",
         (SELECT ended_at FROM stream WHERE id = $2) AS "streamEndedAt",
         (SELECT ended_at FROM stream_subscription WHERE id = $3) AS "subscriptionEndedAt"`,
      [roomId, streamId, subscriptionId],
    )) as { memberCount: number; streamEndedAt: Date | null; subscriptionEndedAt: Date | null }[]
    expect(preserved[0]).toEqual({
      memberCount: 2,
      streamEndedAt: null,
      subscriptionEndedAt: null,
    })
  } finally {
    await Promise.all([originalHost.context.close(), newHost.context.close()])
    await removeRoom(authSessions, roomId)
  }
})
