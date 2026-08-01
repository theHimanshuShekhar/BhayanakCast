import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { AuthSessionFixture } from './fixtures'

const HOST = {
  id: '812345678901234567',
  username: 'ban-host',
  global_name: 'Ban Host',
  avatar: 'ban-host-avatar',
  email: 'ban-host@example.test',
  verified: true,
}

const MEMBER = {
  id: '812345678901234568',
  username: 'ban-member',
  global_name: 'Ban Target',
  avatar: 'ban-target-avatar',
  email: 'ban-target@example.test',
  verified: true,
}

async function createRoom(page: Page) {
  await page.goto('/')
  await page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill('Contextual safety room')
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

test('keyboard member menus enforce Host-only confirmed Room Bans and clear-ban re-entry', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST)
  const member = await authSessions.createBrowserContext(MEMBER)
  const hostPage = await host.context.newPage()
  const memberPage = await member.context.newPage()
  await hostPage.setViewportSize({ width: 1280, height: 800 })
  await memberPage.setViewportSize({ width: 1280, height: 800 })
  const roomId = await createRoom(hostPage)

  try {
    await memberPage.goto(`/rooms/${roomId}`)
    await memberPage.getByRole('button', { name: 'Join' }).click()
    await expect(memberPage.locator('[data-room-state="admitted"]')).toBeVisible()
    await expect(hostPage.getByRole('button', { name: 'Actions for Ban Target' })).toBeVisible()

    // Report is persistent and keyboard reachable for an ordinary member;
    // Host-only actions do not exist in that Account's menu.
    const memberMenuTrigger = memberPage.getByRole('button', { name: 'Actions for Ban Host' })
    await memberMenuTrigger.focus()
    await memberMenuTrigger.press('ArrowDown')
    const memberMenu = memberPage.getByRole('menu', { name: 'Actions for Ban Host' })
    await expect(memberMenu.getByRole('menuitem', { name: 'Report' })).toBeFocused()
    await expect(memberMenu.getByRole('menuitem', { name: /Ban from room/ })).toHaveCount(0)
    await memberMenu.press('Escape')
    await expect(memberMenuTrigger).toBeFocused()

    const hostMenuTrigger = hostPage.getByRole('button', { name: 'Actions for Ban Target' })
    await hostMenuTrigger.focus()
    await hostMenuTrigger.press('ArrowDown')
    const hostMenu = hostPage.getByRole('menu', { name: 'Actions for Ban Target' })
    await expect(hostMenu.getByRole('menuitem', { name: 'Report' })).toBeVisible()
    await hostMenu.getByRole('menuitem', { name: 'Ban from room…' }).click()

    const confirmation = hostPage.getByRole('dialog', {
      name: 'Ban Ban Target from this room?',
    })
    await expect(confirmation).toContainText('Ban Target will be removed now')
    await expect(confirmation).toContainText('cannot re-enter until a Host clears this ban or the room ends')
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(memberPage.locator('[data-room-state="admitted"]')).toBeVisible()
    await expect(hostMenuTrigger).toBeVisible()

    await hostMenuTrigger.press('ArrowDown')
    await hostPage
      .getByRole('menu', { name: 'Actions for Ban Target' })
      .getByRole('menuitem', { name: 'Ban from room…' })
      .click()
    await hostPage
      .getByRole('dialog', { name: 'Ban Ban Target from this room?' })
      .getByRole('button', { name: 'Ban Ban Target' })
      .click()

    await expect(memberPage.locator('[data-room-state="pre-admission"]')).toBeVisible()
    await expect(hostPage.getByRole('button', { name: 'Actions for Ban Target' })).toHaveCount(0)
    await hostPage.getByRole('tab', { name: 'Activity' }).click()
    await expect(hostPage.getByText('Ban Target is no longer in this room.')).toBeVisible()

    await memberPage.getByRole('button', { name: 'Join' }).click()
    await expect(memberPage.getByRole('alert')).toContainText('You cannot join this room.')
    await expect(memberPage.locator('[data-room-state="pre-admission"]')).toBeVisible()

    await hostPage.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = hostPage.getByRole('dialog', { name: 'Room settings' })
    await settings.getByRole('tab', { name: 'Bans' }).click()
    await expect(settings.getByText('Ban Target', { exact: true })).toBeVisible()
    await settings.getByRole('button', { name: 'Clear Room Ban for Ban Target' }).click()
    await expect(settings.getByText('No one is banned from this room.')).toBeVisible()
    await settings.getByRole('button', { name: 'Close' }).click()

    await memberPage.getByRole('button', { name: 'Join' }).click()
    await expect(memberPage.locator('[data-room-state="admitted"]')).toBeVisible()
  } finally {
    await removeRoom(authSessions, roomId)
    await Promise.all([host.context.close(), member.context.close()])
  }
})
