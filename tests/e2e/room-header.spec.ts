import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { AuthSessionFixture } from './fixtures'

const HOST_PROFILE = {
  id: '161803398874989484',
  username: 'header-host',
  global_name: 'Header Host',
  avatar: 'header-host-avatar',
  email: 'header-host@example.test',
  verified: true,
}

const MEMBER_PROFILE = {
  id: '141421356237309504',
  username: 'header-member',
  global_name: 'Header Member',
  avatar: 'header-member-avatar',
  email: 'header-member@example.test',
  verified: true,
}

const LONG_NAME = `Maximum content protects controls ${'N'.repeat(42)}`
const LONG_DESCRIPTION = `A bounded description ${'stays secondary while controls remain reachable '.repeat(3)}`.slice(0, 140)
const TAGS = Array.from({ length: 5 }, (_, index) => `long-room-tag-${index + 1}-${'x'.repeat(7)}`)

async function createAdmittedRoom(page: Page) {
  await page.goto('/')
  await page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill('Header contract room')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
  return new URL(page.url()).pathname.split('/').at(-1) as string
}

async function removeRoom(authSessions: AuthSessionFixture, roomId: string) {
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
}

test('desktop and medium keep the complete admitted Room header in two bounded rows under maximum content', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const page = await host.context.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  const roomId = await createAdmittedRoom(page)

  try {
    await authSessions.sql(
      `UPDATE room
       SET name = $2, description = $3, category = $4, tags = $5::text[]
       WHERE id = $1`,
      [roomId, LONG_NAME, LONG_DESCRIPTION, 'Very long clubhouse category', TAGS],
    )
    await page.reload()

    const header = page.locator('.room-live-header')
    await expect(header.getByRole('link', { name: 'Back / Home' })).toBeVisible()
    await expect(header.getByRole('heading', { name: LONG_NAME })).toBeVisible()
    await expect(header.getByText('Public', { exact: true })).toBeVisible()
    await expect(header.getByText('Live', { exact: true })).toBeVisible()
    await expect(header.getByText('Header Host', { exact: true })).toBeVisible()
    await expect(header.getByText('1 member', { exact: true })).toBeVisible()
    await expect(header.getByText('0 Streams', { exact: true })).toBeVisible()
    await expect(header.locator('.room-live-header__secondary time')).toBeVisible()
    await expect(header.getByText(LONG_DESCRIPTION, { exact: true })).toBeAttached()
    for (const tag of TAGS) {
      await expect(header.getByText(`#${tag}`, { exact: true })).toBeAttached()
    }

    const settings = header.getByRole('button', { name: 'Settings' })
    await expect(settings).toBeVisible()
    const geometry = await header.evaluate((node) => {
      const primary = node.querySelector('.room-live-header__primary')
      const secondary = node.querySelector('.room-live-header__secondary')
      const heading = node.querySelector('h1')
      const settingsButton = node.querySelector('.room-live-header__settings')
      if (!primary || !secondary || !heading || !settingsButton) {
        throw new Error('Header composition is incomplete')
      }
      const headerBox = node.getBoundingClientRect()
      const primaryBox = primary.getBoundingClientRect()
      const secondaryBox = secondary.getBoundingClientRect()
      const settingsBox = settingsButton.getBoundingClientRect()
      return {
        twoRows: secondaryBox.top >= primaryBox.bottom - 1,
        bounded: node.scrollWidth <= node.clientWidth + 1,
        nameTruncated: heading.scrollWidth > heading.clientWidth,
        settingsInside:
          settingsBox.left >= headerBox.left && settingsBox.right <= headerBox.right,
      }
    })
    expect(geometry).toEqual({
      twoRows: true,
      bounded: true,
      nameTruncated: true,
      settingsInside: true,
    })

    await settings.focus()
    await page.keyboard.press('Enter')
    const desktopSettings = page.getByRole('dialog', { name: 'Room settings' })
    await expect(desktopSettings).toBeVisible()
    await desktopSettings.getByRole('button', { name: 'Cancel' }).click()

    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(header.locator('.room-live-header__secondary')).toBeVisible()
    await expect(settings).toBeVisible()
    expect(
      await header.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true)
  } finally {
    await removeRoom(authSessions, roomId)
  }
})

test('mobile Details exposes canonical metadata to the Host, returns focus, and withholds Settings from members', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const hostPage = await host.context.newPage()
  const roomId = await createAdmittedRoom(hostPage)

  try {
    await authSessions.sql(
      `UPDATE room
       SET name = $2, description = $3, category = $4, tags = $5::text[]
       WHERE id = $1`,
      [roomId, LONG_NAME, LONG_DESCRIPTION, 'Community', TAGS],
    )
    await hostPage.setViewportSize({ width: 390, height: 844 })
    await hostPage.reload()

    const header = hostPage.locator('.room-live-header')
    await expect(header.getByRole('link', { name: 'Back' })).toBeVisible()
    await expect(header.getByRole('heading', { name: LONG_NAME })).toBeVisible()
    await expect(header.getByText('Public', { exact: true })).toBeVisible()
    await expect(header.locator('.room-live-header__mobile-countdown time')).toBeVisible()
    await expect(header.locator('.room-live-header__secondary')).toBeHidden()

    const detailsTrigger = header.getByRole('button', { name: 'Details' })
    await detailsTrigger.focus()
    await hostPage.keyboard.press('Enter')
    const details = hostPage.getByRole('complementary', { name: 'Room details' })
    await expect(details).toBeVisible()
    await expect(details).toContainText('Header Host')
    await expect(details).toContainText(LONG_DESCRIPTION)
    await expect(details).toContainText('1 of 10')
    await expect(details.getByRole('button', { name: 'Settings' })).toBeVisible()
    await details.getByRole('button', { name: 'Settings' }).click()
    const settingsDialog = hostPage.getByRole('dialog', { name: 'Room settings' })
    await expect(settingsDialog).toBeVisible()
    await settingsDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(details).toBeVisible()
    await expect(details).toHaveAttribute('data-height', '55')
    await details.getByRole('button', { name: 'Expand Details to 90%' }).click()
    await expect(details).toHaveAttribute('data-height', '90')
    await hostPage.keyboard.press('Escape')
    await expect(details).toHaveCount(0)
    await expect(detailsTrigger).toBeFocused()

    const member = await authSessions.createBrowserContext(MEMBER_PROFILE)
    const memberPage = await member.context.newPage()
    await memberPage.setViewportSize({ width: 390, height: 844 })
    await memberPage.goto(`/rooms/${roomId}`)
    await memberPage.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(memberPage.locator('[data-room-state="admitted"]')).toBeVisible()
    const memberDetailsTrigger = memberPage.getByRole('button', { name: 'Details' })
    await memberDetailsTrigger.click()
    const memberDetails = memberPage.getByRole('complementary', { name: 'Room details' })
    await expect(memberDetails).toContainText('Header Host')
    await expect(memberDetails).toContainText('2 of 10')
    await expect(memberDetails.getByRole('button', { name: 'Settings' })).toHaveCount(0)
    await expect(memberPage.getByRole('button', { name: 'Settings' })).toHaveCount(0)
    await memberDetails.getByRole('button', { name: 'Close' }).click()
    await expect(memberDetailsTrigger).toBeFocused()
  } finally {
    await removeRoom(authSessions, roomId)
  }
})
