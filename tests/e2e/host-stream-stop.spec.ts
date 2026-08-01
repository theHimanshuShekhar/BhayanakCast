import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { AuthSessionFixture } from './fixtures'
import { installWebRtcProbe } from '../helpers/webrtc'

const HOST = {
  id: '832345678901234567',
  username: 'stream-stop-host',
  global_name: 'Stop Host',
  avatar: 'stream-stop-host-avatar',
  email: 'stream-stop-host@example.test',
  verified: true,
}

const OWNER = {
  id: '832345678901234568',
  username: 'stream-owner',
  global_name: 'Stream Owner',
  avatar: 'stream-owner-avatar',
  email: 'stream-owner@example.test',
  verified: true,
}

const VIEWER = {
  id: '832345678901234569',
  username: 'stream-viewer',
  global_name: 'Stream Viewer',
  avatar: 'stream-viewer-avatar',
  email: 'stream-viewer@example.test',
  verified: true,
}

async function createRoom(page: Page) {
  await page.goto('/')
  await page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill('Host Stream stop room')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  return new URL(page.url()).pathname.split('/').at(-1) as string
}

async function join(page: Page, roomId: string) {
  await page.goto(`/rooms/${roomId}`)
  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
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

test('Host stops one member Stream while viewers fall back and the owner stays eligible', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST)
  const owner = await authSessions.createBrowserContext(OWNER)
  const viewer = await authSessions.createBrowserContext(VIEWER)
  await installWebRtcProbe(viewer.context, 'pass')
  const hostPage = await host.context.newPage()
  const ownerPage = await owner.context.newPage()
  const viewerPage = await viewer.context.newPage()
  await hostPage.setViewportSize({ width: 390, height: 844 })
  await ownerPage.setViewportSize({ width: 1024, height: 768 })
  await viewerPage.setViewportSize({ width: 1280, height: 800 })
  const roomId = await createRoom(hostPage)

  try {
    await join(ownerPage, roomId)
    await join(viewerPage, roomId)
    const memberships = (await authSessions.sql(
      `SELECT membership.id, account.name
         FROM room_membership membership
         JOIN "user" account ON account.id = membership.account_id
        WHERE membership.room_id = $1 AND membership.left_at IS NULL`,
      [roomId],
    )) as { id: string; name: string }[]
    const ownerMembershipId = memberships.find((row) => row.name === 'Stream Owner')?.id
    if (!ownerMembershipId) throw new Error('Missing Stream Owner membership')
    const streamId = randomUUID()
    await authSessions.sql(
      `INSERT INTO stream (id, room_id, membership_id, started_at)
       VALUES ($1, $2, $3, now())`,
      [streamId, roomId, ownerMembershipId],
    )
    await Promise.all([hostPage.reload(), viewerPage.reload()])
    await Promise.all([
      expect(hostPage.locator('[data-room-state="admitted"]')).toBeVisible(),
      expect(ownerPage.locator('[data-room-state="admitted"]')).toBeVisible(),
      expect(viewerPage.locator('[data-room-state="admitted"]')).toBeVisible(),
    ])

    const viewerMenuTrigger = viewerPage.getByRole('button', {
      name: 'Actions for Stream Owner',
    })
    await viewerMenuTrigger.click()
    await expect(
      viewerPage
        .getByRole('menu', { name: 'Actions for Stream Owner' })
        .getByRole('menuitem', { name: /Stop Stream/ }),
    ).toHaveCount(0)
    await viewerPage.keyboard.press('Escape')

    const viewerTile = viewerPage
      .getByRole('listitem')
      .filter({ has: viewerPage.getByText('Stream Owner', { exact: true }) })
    await viewerTile.getByRole('button', { name: 'Watch', exact: true }).click()
    await expect(viewerTile.getByText(/Connecting… attempt/)).toBeVisible()

    await hostPage.getByRole('button', { name: 'People' }).click()
    const hostPeople = hostPage.getByRole('tabpanel', { name: 'People' })
    const hostMenuTrigger = hostPeople.getByRole('button', {
      name: 'Actions for Stream Owner',
    })
    await hostMenuTrigger.click()
    await hostPage
      .getByRole('menu', { name: 'Actions for Stream Owner' })
      .getByRole('menuitem', { name: 'Stop Stream…' })
      .click()

    const confirmation = hostPage.getByRole('dialog', {
      name: /Stop Stream Owner’s current Stream/,
    })
    await expect(confirmation).toContainText(
      'Only Stream Owner’s current Stream and its related watches will end.',
    )
    await expect(confirmation).toContainText(
      'They will stay in the room and may start another Stream through the normal gates.',
    )
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect(viewerTile.getByText(/Connecting… attempt/)).toBeVisible()

    await hostMenuTrigger.click()
    await hostPage
      .getByRole('menu', { name: 'Actions for Stream Owner' })
      .getByRole('menuitem', { name: 'Stop Stream…' })
      .click()
    await confirmation
      .getByRole('button', { name: 'Stop Stream Owner’s Stream' })
      .click()
    await expect(confirmation).toHaveCount(0, { timeout: 15_000 })

    await expect(viewerTile.getByText(/Connecting… attempt/)).toHaveCount(0)
    await expect(viewerTile.getByRole('button', { name: 'Watch' })).toHaveCount(0)
    await expect(hostMenuTrigger).toBeVisible()
    await expect(ownerPage.locator('[data-room-state="admitted"]')).toBeVisible()
    await expect(ownerPage.getByRole('button', { name: 'Start Stream' })).toBeEnabled()

    await hostPage.getByRole('button', { name: 'Activity' }).click()
    await expect(hostPage.getByText('Stream Owner stopped streaming.')).toBeVisible()
    await expect(hostPage.getByText('Stop Host stopped streaming.')).toHaveCount(0)
  } finally {
    await removeRoom(authSessions, roomId)
    await Promise.all([host.context.close(), owner.context.close(), viewer.context.close()])
  }
})
