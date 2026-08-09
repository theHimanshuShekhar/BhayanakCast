import { expect, gotoHydrated, test } from './fixtures'

const STREAMER = {
  id: '842345678901234567',
  username: 'stream-start-member',
  global_name: 'Stream Start Member',
  avatar: 'stream-start-member-avatar',
  email: 'stream-start-member@example.test',
  verified: true,
}

test('a room member can start a captured Stream', async ({ authSessions }) => {
  const streamer = await authSessions.createBrowserContext(STREAMER)
  const page = await streamer.context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  await gotoHydrated(page, '/')
  await page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill('Stream start room')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const roomId = new URL(page.url()).pathname.split('/').at(-1) as string

  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
    const start = page.getByRole('button', { name: 'Start Stream' })
    await expect(start).toBeEnabled({ timeout: 30_000 })
    await page.evaluate(() => {
      const getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getDisplayMedia = async (options) => {
        try {
          return await getDisplayMedia({ video: true })
        } catch (error) {
          const failure = error as Error
          document.body.dataset.captureFailure = `${failure.name}: ${failure.message}`
          throw error
        }
      }
    })
    await start.click()
    await expect(
      page.getByRole('button', { name: 'Stop Stream' }).or(page.getByRole('alert')),
    ).toBeVisible()
    expect(await page.locator('body').getAttribute('data-capture-failure')).toBeNull()

    await expect(page.getByRole('button', { name: 'Stop Stream' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    await authSessions.sql('DELETE FROM stream_subscription WHERE stream_id IN (SELECT id FROM stream WHERE room_id = $1)', [roomId])
    await authSessions.sql('DELETE FROM stream WHERE room_id = $1', [roomId])
    await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
    await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
  }
})
