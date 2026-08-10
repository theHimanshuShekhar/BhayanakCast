import { expect, test } from './fixtures'

test('keeps Home usable while an authenticated realtime connection recovers', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '102938475610293862',
    username: 'home-reconnect',
    global_name: 'Home Reconnect',
    avatar: null,
    email: 'home-reconnect@example.test',
    verified: true,
  })
  const page = await signedIn.context.newPage()
  const socketHandshake = page.waitForResponse(
    (response) =>
      response.url().includes('/socket.io/') &&
      response.url().includes('transport=polling') &&
      response.status() === 200,
  )
  await page.goto('/')
  await socketHandshake
  await expect(page.getByTestId('home-shell')).toBeVisible()
  const search = page.getByRole('searchbox', { name: 'Find rooms and people' })
  await search.fill('room')
  await expect(search).toHaveValue('room')

  await signedIn.context.setOffline(true)
  const strip = page.getByTestId('home-connection-status')
  await expect(strip).toContainText('Counts are paused — last seen')
  await expect(strip).toContainText(/attempt \d+/)
  await expect(page.getByTestId('home-shell')).toBeVisible()
  await expect(search).toHaveValue('room')

  await signedIn.context.setOffline(false)
  // Recovery is announced, then retires itself without a click.
  await expect(strip).toContainText('Rooms are current again.')
  await expect(strip).toHaveCount(0)
  await expect(search).toHaveValue('room')
})

test('retries a failed canonical Home refresh while the socket stays connected', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '102938475610293863',
    username: 'home-retry',
    global_name: 'Home Retry',
    avatar: null,
    email: 'home-retry@example.test',
    verified: true,
  })
  const page = await signedIn.context.newPage()
  await page.setViewportSize({ width: 320, height: 800 })
  const socketHandshake = page.waitForResponse(
    (response) =>
      response.url().includes('/socket.io/') &&
      response.url().includes('transport=polling') &&
      response.status() === 200,
  )
  await page.goto('/')
  await socketHandshake
  await expect(page.getByTestId('home-shell')).toBeVisible()

  let shouldFail = false
  await page.route('**/_serverFn/**', async (route) => {
    if (shouldFail) {
      await route.abort()
      return
    }
    await route.continue()
  })

  await signedIn.context.setOffline(true)
  await expect(page.getByTestId('home-connection-status')).toBeVisible()
  shouldFail = true
  await signedIn.context.setOffline(false)
  await expect(page.getByTestId('home-connection-status')).toContainText(
    "You're seeing rooms as they were",
  )
  await expect(page.getByTestId('home-connection-retry')).toBeEnabled()
  const retryBox = await page.getByTestId('home-connection-retry').boundingBox()
  expect(Math.round(retryBox?.width ?? 0)).toBeGreaterThanOrEqual(44)
  expect(Math.round(retryBox?.height ?? 0)).toBeGreaterThanOrEqual(44)
  shouldFail = false
  await page.getByTestId('home-connection-retry').click()
  await expect(page.getByTestId('home-connection-status')).toHaveCount(0)
  await expect(page.getByTestId('home-shell')).toBeVisible()
})
