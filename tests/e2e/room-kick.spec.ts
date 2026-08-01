import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { AuthSessionFixture } from './fixtures'

const HOST = {
  id: '822345678901234567',
  username: 'kick-host',
  global_name: 'Kick Host',
  avatar: 'kick-host-avatar',
  email: 'kick-host@example.test',
  verified: true,
}

const MEMBER = {
  id: '822345678901234568',
  username: 'kick-member',
  global_name: 'Kick Target',
  avatar: 'kick-target-avatar',
  email: 'kick-target@example.test',
  verified: true,
}

async function createRoom(page: Page) {
  await page.goto('/')
  await page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill('Immediate re-entry room')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  return new URL(page.url()).pathname.split('/').at(-1) as string
}

async function removeRoom(authSessions: AuthSessionFixture, roomId: string) {
  await authSessions.sql(
    'DELETE FROM stream_subscription WHERE stream_id IN (SELECT id FROM stream WHERE room_id = $1)',
    [roomId],
  )
  await authSessions.sql('DELETE FROM stream WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room_ban WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
}

test('Host kick confirms immediate re-entry, preserves the URL and Host, and creates no Room Ban', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST)
  const member = await authSessions.createBrowserContext(MEMBER)
  const hostPage = await host.context.newPage()
  const memberPage = await member.context.newPage()
  await hostPage.setViewportSize({ width: 1280, height: 800 })
  await memberPage.setViewportSize({ width: 390, height: 844 })
  const roomId = await createRoom(hostPage)
  const roomUrl = `/rooms/${roomId}`

  try {
    await memberPage.goto(roomUrl)
    await memberPage.getByRole('button', { name: 'Join' }).click()
    await expect(memberPage.locator('[data-room-state="admitted"]')).toBeVisible()

    const memberMenuTrigger = memberPage.getByRole('button', { name: 'Actions for Kick Host' })
    await memberMenuTrigger.focus()
    await memberMenuTrigger.press('ArrowDown')
    const memberMenu = memberPage.getByRole('menu', { name: 'Actions for Kick Host' })
    await expect(memberMenu.getByRole('menuitem', { name: 'Kick from room…' })).toHaveCount(0)
    await expect(memberMenu.getByRole('menuitem', { name: 'Ban from room…' })).toHaveCount(0)
    await memberMenu.press('Escape')
    await expect(memberMenuTrigger).toBeFocused()

    const hostMenuTrigger = hostPage.getByRole('button', { name: 'Actions for Kick Target' })
    await hostMenuTrigger.focus()
    await hostMenuTrigger.press('ArrowDown')
    await hostPage
      .getByRole('menu', { name: 'Actions for Kick Target' })
      .getByRole('menuitem', { name: 'Kick from room…' })
      .click()

    const confirmation = hostPage.getByRole('dialog', {
      name: 'Kick Kick Target from this room?',
    })
    await expect(confirmation).toContainText('Kick Target will be removed now')
    await expect(confirmation).toContainText('can re-enter immediately if the room still allows them')
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(memberPage.locator('[data-room-state="admitted"]')).toBeVisible()

    await hostPage.setViewportSize({ width: 900, height: 800 })
    await hostMenuTrigger.press('ArrowDown')
    await hostPage
      .getByRole('menu', { name: 'Actions for Kick Target' })
      .getByRole('menuitem', { name: 'Kick from room…' })
      .click()
    await hostPage
      .getByRole('dialog', { name: 'Kick Kick Target from this room?' })
      .getByRole('button', { name: 'Kick Kick Target' })
      .click()

    await expect(memberPage).toHaveURL(new RegExp(`${roomUrl}$`))
    await expect(memberPage.locator('[data-room-state="pre-admission"]')).toBeVisible()
    await expect(hostPage.locator('.room-live-header__host')).toContainText('Kick Host')
    await expect(hostPage.getByRole('button', { name: 'Actions for Kick Target' })).toHaveCount(0)
    await hostPage.getByRole('tab', { name: 'Activity' }).click()
    await expect(hostPage.getByText('Kick Target is no longer in this room.')).toBeVisible()

    await hostPage.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = hostPage.getByRole('dialog', { name: 'Room settings' })
    await settings.getByRole('tab', { name: 'Bans' }).click()
    await expect(settings.getByText('No one is banned from this room.')).toBeVisible()
    await settings.getByRole('button', { name: 'Close' }).click()

    await memberPage.getByRole('button', { name: 'Join' }).click()
    await expect(memberPage).toHaveURL(new RegExp(`${roomUrl}$`))
    await expect(memberPage.locator('[data-room-state="admitted"]')).toBeVisible()
    await expect(hostPage.getByRole('button', { name: 'Actions for Kick Target' })).toBeVisible()
    await expect(hostPage.locator('.room-live-header__host')).toContainText('Kick Host')
  } finally {
    await removeRoom(authSessions, roomId)
    await Promise.all([host.context.close(), member.context.close()])
  }
})
