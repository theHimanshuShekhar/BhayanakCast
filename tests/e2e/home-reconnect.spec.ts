import { expect, test, gotoHydrated } from './fixtures'

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
  await gotoHydrated(page, '/')
  await socketHandshake
  await expect(page.getByTestId('home-shell')).toBeVisible()
  const search = page.getByRole('searchbox', { name: 'Find rooms and people' })
  await search.fill('room')
  await expect(search).toHaveValue('room')
  await search.press('Enter')
  await expect(page.getByTestId('home-counter')).toContainText(
    /\d+ rooms? and \d+ (?:person|people) match “room”/,
  )

  await signedIn.context.setOffline(true)
  const strip = page.getByTestId('home-connection-status')
  await expect(strip).toContainText(
    /Counts are paused — last seen.*attempt \d+/,
  )
  await expect(page.getByTestId('home-shell')).toBeVisible()
  await expect(search).toHaveValue('room')
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __HOME_RECOVERY_OBSERVER__?: MutationObserver
      __HOME_RECOVERY_SEEN__?: boolean
    }
    testWindow.__HOME_RECOVERY_SEEN__ = false
    const observer = new MutationObserver(() => {
      if (
        document
          .querySelector('[data-testid="home-connection-status"]')
          ?.textContent?.includes('Rooms are current again.')
      ) {
        testWindow.__HOME_RECOVERY_SEEN__ = true
      }
    })
    observer.observe(document.body, {
      characterData: true,
      childList: true,
      subtree: true,
    })
    testWindow.__HOME_RECOVERY_OBSERVER__ = observer
  })
  await signedIn.context.setOffline(false)
  // Recovery is announced, then retires itself without a click.
  try {
    await page.waitForFunction(
      () =>
        (window as typeof window & { __HOME_RECOVERY_SEEN__?: boolean })
          .__HOME_RECOVERY_SEEN__ === true,
      undefined,
      { timeout: 15_000 },
    )
  } finally {
    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __HOME_RECOVERY_OBSERVER__?: MutationObserver
      }
      testWindow.__HOME_RECOVERY_OBSERVER__?.disconnect()
      delete testWindow.__HOME_RECOVERY_OBSERVER__
    })
  }
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
  await gotoHydrated(page, '/')
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
