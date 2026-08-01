import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test, type AuthSessionFixture, gotoHydrated } from './fixtures'

const HOST = {
  id: '718281828459045235',
  username: 'chat-host',
  global_name: 'Chat Host',
  avatar: 'chat-host-avatar',
  email: 'chat-host@example.test',
  verified: true,
}

const MEMBERS = [
  {
    id: '618281828459045236',
    username: 'chat-alex',
    global_name: 'Alex',
    avatar: 'chat-alex-avatar',
    email: 'chat-alex@example.test',
    verified: true,
  },
  {
    id: '518281828459045237',
    username: 'chat-bailey',
    global_name: 'Bailey',
    avatar: 'chat-bailey-avatar',
    email: 'chat-bailey@example.test',
    verified: true,
  },
  {
    id: '418281828459045238',
    username: 'chat-casey',
    global_name: 'Casey',
    avatar: 'chat-casey-avatar',
    email: 'chat-casey@example.test',
    verified: true,
  },
] as const

async function createAdmittedRoom(page: Page, name: string) {
  await gotoHydrated(page, '/')
  await page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
  return new URL(page.url()).pathname.split('/').at(-1) as string
}

async function joinRoom(page: Page, roomId: string) {
  await page.goto(`/rooms/${roomId}`)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
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

async function send(page: Page, body: string) {
  await page.getByLabel('Message', { exact: true }).fill(body)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

async function dropRoom(authSessions: AuthSessionFixture, roomId: string) {
  await authSessions.sql('DELETE FROM report WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM message WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
}

test('multi-Account Chat preserves reading position and exposes canonical local recovery', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST)
  const hostPage = await host.context.newPage()
  const roomId = await createAdmittedRoom(hostPage, 'Chat feedback room')
  const member = await authSessions.createBrowserContext(MEMBERS[0])
  const memberPage = await member.context.newPage()
  try {
    await joinRoom(memberPage, roomId)
    const memberAccountId = await sessionId(memberPage)
    await hostPage.setViewportSize({ width: 1440, height: 900 })
    await memberPage.setViewportSize({ width: 1440, height: 900 })

    const membership = (await authSessions.sql(
      `SELECT id FROM room_membership
        WHERE room_id = $1 AND account_id = $2 AND left_at IS NULL`,
      [roomId, memberAccountId],
    )) as { readonly id: string }[]
    for (let index = 0; index < 18; index += 1) {
      await authSessions.sql(
        `INSERT INTO message (id, room_id, membership_id, body, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          roomId,
          membership[0]!.id,
          `Earlier message ${index} ${'context '.repeat(10)}`,
          new Date(Date.now() + index),
        ],
      )
    }
    await gotoHydrated(hostPage, hostPage.url())
    await expect(hostPage.getByLabel('Message', { exact: true })).toBeEnabled({
      timeout: 15_000,
    })
    await expect(memberPage.getByLabel('Message', { exact: true })).toBeEnabled()
    await expect(hostPage.getByText(/Earlier message 17/)).toBeVisible()
    const panel = hostPage.locator('.room-dock').getByRole('tabpanel')
    await panel.evaluate((node) => {
      node.scrollTop = node.scrollHeight
      node.dispatchEvent(new Event('scroll'))
    })
    await expect
      .poll(() =>
        panel.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight),
      )
      .toBeLessThanOrEqual(24)
    await panel.evaluate((node) => {
      node.scrollTop = Math.floor((node.scrollHeight - node.clientHeight) / 2)
      node.dispatchEvent(new Event('scroll'))
    })
    const retainedPosition = await panel.evaluate((node) => node.scrollTop)
    await hostPage.getByLabel('Message', { exact: true }).fill('Retained draft')
    await hostPage.getByRole('tab', { name: 'People' }).click()
    await hostPage.getByRole('tab', { name: 'Chat' }).click()
    await expect(hostPage.getByLabel('Message', { exact: true })).toHaveValue('Retained draft')
    expect(await panel.evaluate((node) => node.scrollTop)).toBe(retainedPosition)

    await hostPage.getByRole('tab', { name: 'People' }).click()
    await send(memberPage, 'Hidden tab unread')
    await expect(hostPage.getByRole('tab', { name: 'Chat' }).locator('.room-dock__badge')).toHaveText('1')
    await hostPage.getByRole('tab', { name: 'Chat' }).click()
    await expect(hostPage.getByRole('tab', { name: 'Chat' }).locator('.room-dock__badge')).toHaveCount(0)
    await expect(hostPage.getByText('Hidden tab unread', { exact: true })).toBeVisible()
    await expect(hostPage.getByLabel('Message', { exact: true })).toHaveValue('Retained draft')
    await hostPage.getByLabel('Message', { exact: true }).fill('')


    await send(memberPage, 'Follow the latest')
    await expect(hostPage.getByText('Follow the latest', { exact: true })).toBeVisible()
    await expect
      .poll(() =>
        panel.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight),
      )
      .toBeLessThanOrEqual(24)

    await panel.evaluate((node) => {
      node.scrollTop = 0
      node.dispatchEvent(new Event('scroll'))
    })
    const readingPosition = await panel.evaluate((node) => node.scrollTop)
    await send(memberPage, 'Preserve the reading position')
    await expect(hostPage.getByRole('button', { name: 'New messages' })).toBeVisible()
    expect(await panel.evaluate((node) => node.scrollTop)).toBe(readingPosition)
    await hostPage.getByRole('button', { name: 'New messages' }).click()
    await expect
      .poll(() =>
        panel.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight),
      )
      .toBeLessThanOrEqual(24)

    await authSessions.sql(
      `UPDATE room_membership SET left_at = joined_at + interval '1 second'
        WHERE room_id = $1 AND account_id = $2 AND left_at IS NULL`,
      [roomId, memberAccountId],
    )
    await send(memberPage, 'Retry this local message')
    await expect(memberPage.getByText('Not sent.')).toBeVisible()
    await authSessions.sql(
      `UPDATE room_membership SET left_at = NULL
        WHERE room_id = $1 AND account_id = $2`,
      [roomId, memberAccountId],
    )
    await memberPage.getByRole('button', { name: 'Retry' }).click()
    await expect(memberPage.getByText('Not sent.')).toHaveCount(0)
    await expect(
      memberPage.getByText('Retry this local message', { exact: true }),
    ).toHaveCount(1)

    await authSessions.sql(
      `UPDATE room_membership SET left_at = joined_at + interval '1 second'
        WHERE room_id = $1 AND account_id = $2 AND left_at IS NULL`,
      [roomId, memberAccountId],
    )
    await send(memberPage, 'Discard this local message')
    await memberPage.getByRole('button', { name: 'Discard' }).click()
    await expect(memberPage.getByText('Discard this local message', { exact: true })).toHaveCount(0)
    await authSessions.sql(
      `UPDATE room_membership SET left_at = NULL
        WHERE room_id = $1 AND account_id = $2`,
      [roomId, memberAccountId],
    )

    await memberPage.getByLabel('Message', { exact: true }).fill('x'.repeat(450))
    await memberPage.setViewportSize({ width: 900, height: 800 })
    await expect(memberPage.getByLabel('Message', { exact: true })).toBeVisible()
    await memberPage.setViewportSize({ width: 390, height: 844 })
    await memberPage
      .locator('.room-mobile-bar')
      .getByRole('button', { name: 'Chat', exact: true })
      .click()
    await expect(memberPage.getByLabel('Message', { exact: true })).toBeVisible()
    const mobileComposer = await memberPage.locator('.room-chat__composer').boundingBox()
    expect(mobileComposer?.x ?? 391).toBeGreaterThanOrEqual(0)
    expect((mobileComposer?.x ?? 0) + (mobileComposer?.width ?? 391)).toBeLessThanOrEqual(390)

    await expect(memberPage.getByText('450 / 500 characters')).toBeVisible()
    await member.context.setOffline(true)
    await expect(memberPage.getByText('Chat is reconnecting. Sending is unavailable.')).toBeVisible()
    await expect(memberPage.getByLabel('Message', { exact: true })).toBeDisabled()
    await member.context.setOffline(false)
    await expect(memberPage.getByLabel('Message', { exact: true })).toBeEnabled()
  } finally {
    await dropRoom(authSessions, roomId)
  }
})

test('multi-Account Chat summarizes typing and keeps Report and chat-only Mute persistent', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST)
  const hostPage = await host.context.newPage()
  const roomId = await createAdmittedRoom(hostPage, 'Chat safety room')
  const members: { page: Page }[] = []
  for (const profile of MEMBERS) {
    const member = await authSessions.createBrowserContext(profile)
    const page = await member.context.newPage()
    await joinRoom(page, roomId)
    members.push({ page })
  }
  try {
    await expect(hostPage.getByLabel('Message', { exact: true })).toBeEnabled()
    for (const [index, { page }] of members.entries()) {
      await expect(page.getByLabel('Message', { exact: true })).toBeEnabled()
      await page.getByLabel('Message', { exact: true }).fill(`typing ${index}`)
    }
    await expect(
      hostPage.getByText('Alex, Bailey, and 1 other are typing…', { exact: true }),
    ).toBeVisible()
    await expect(
      hostPage.getByText('Alex, Bailey, and 1 other are typing…', { exact: true }),
    ).toHaveCount(0, { timeout: 7_000 })


    await members[0]!.page.getByLabel('Message', { exact: true }).fill('Report then mute this message')
    await members[0]!.page.getByRole('button', { name: 'Send', exact: true }).click()
    const message = hostPage
      .locator('.room-chat__message')
      .filter({ hasText: 'Report then mute this message' })
    await message.getByRole('button', { name: 'Actions for message from Alex' }).click()
    await hostPage.getByRole('menuitem', { name: 'Report message…' }).click()
    const report = hostPage.locator('.room-dialog')
    await report.locator('button[type="submit"]').click()
    await expect(report.getByText('Thanks — this report is with the review queue.')).toBeVisible()
    await report.getByRole('button', { name: 'Close' }).click()
    await members[0]!.page.getByLabel('Message', { exact: true }).fill('muted typing')
    await members[1]!.page.getByLabel('Message', { exact: true }).fill('typing again')
    await members[2]!.page.getByLabel('Message', { exact: true }).fill('typing again')
    await expect(
      hostPage.getByText(/^(Alex|Bailey|Casey), (Alex|Bailey|Casey), and 1 other are typing…$/),
    ).toBeVisible()


    await message.getByRole('button', { name: 'Actions for message from Alex' }).click()
    await hostPage.getByRole('menuitem', { name: 'Mute Alex’s chat' }).click()
    await expect(hostPage.getByText('Report then mute this message', { exact: true })).toHaveCount(0)
    await expect(
      hostPage.getByText('Alex’s chat is muted. Presence and streams are unchanged.'),
    ).toBeVisible()
    await expect(hostPage.getByText('Bailey and Casey are typing…', { exact: true })).toBeVisible()

    await hostPage.getByRole('tab', { name: /People/ }).click()
    await expect(hostPage.locator('.room-people__member').filter({ hasText: 'Alex' })).toBeVisible()
    await hostPage.getByRole('tab', { name: /Chat/ }).click()
    await hostPage.reload()
    await expect(hostPage.getByText('Report then mute this message', { exact: true })).toHaveCount(0)
    await hostPage.getByRole('tab', { name: /People/ }).click()
    await expect(hostPage.locator('.room-people__member').filter({ hasText: 'Alex' })).toBeVisible()
  } finally {
    await dropRoom(authSessions, roomId)
  }
})
