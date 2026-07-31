import { expect } from '@playwright/test'
// The project fixture provisions a migrated per-worker schema and its own
// server. Using the bare fixture made these specs depend on whoever had
// migrated the default schema first, which is what made them order-dependent.
import { test } from './fixtures'

const STORAGE_KEY = 'bhayanakcast.theme'

test('follows the system theme and ignores an invalid override', async ({
  authSessions,
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript((key) => localStorage.setItem(key, 'sepia'), STORAGE_KEY)

  await page.goto(authSessions.origin)

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    '#0D1422',
  )
})

test('a persisted light override wins over a dark system before readiness', async ({
  authSessions,
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript((key) => localStorage.setItem(key, 'light'), STORAGE_KEY)

  await page.goto(authSessions.origin)

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    '#F6F8FC',
  )
})

test('theme controls work when browser storage access is denied', async ({
  authSessions,
  page,
}) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => {
    const denied = () => {
      throw new DOMException('Storage access denied', 'SecurityError')
    }
    Storage.prototype.getItem = denied
    Storage.prototype.setItem = denied
  })

  await page.goto(authSessions.origin)
  await page.emulateMedia({ colorScheme: 'dark' })

  const toggle = page.locator('.theme-toggle')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(toggle).toHaveAttribute('aria-label', 'Light theme')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(toggle).toHaveAttribute('aria-label', 'Dark theme')
  expect(pageErrors).toEqual([])
})

test('the visible toggle persists an anonymous override across reloads', async ({
  authSessions,
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(authSessions.origin)

  const toggle = page.locator('.theme-toggle')
  await expect(toggle).toHaveAttribute('aria-label', 'Dark theme')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', 'Light theme')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    '#0D1422',
  )
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toBe('dark')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(toggle).toHaveAttribute('aria-label', 'Light theme')
})

test('applies the theme in the head before document readiness', async ({
  authSessions,
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => {
    window.addEventListener(
      'DOMContentLoaded',
      () => {
        document.documentElement.dataset.themeAtReady =
          document.documentElement.dataset.theme ?? ''
      },
      { once: true },
    )
  })
  await page.goto(authSessions.origin)

  await expect(page.locator('script[data-theme-bootstrap]')).toHaveCount(1)
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme-at-ready',
    'dark',
  )
})

test('publishes the root metadata contract', async ({ authSessions, page }) => {
  await page.goto(authSessions.origin)

  await expect(page).toHaveTitle('BhayanakCast')
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'Discover small social screen-sharing rooms.',
  )
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    'width=device-width, initial-scale=1, viewport-fit=cover',
  )
  const themeColor = page.locator('meta[name="theme-color"]')
  await expect(themeColor).toHaveCount(1)
  await expect(themeColor).toHaveAttribute('data-light', '#F6F8FC')
  await expect(themeColor).toHaveAttribute('data-dark', '#0D1422')
})

test('the root control reserves space instead of overlaying route content', async ({
  authSessions,
  page,
}) => {
  await page.goto(`${authSessions.origin}/missing`)

  const layout = await page.evaluate(() => {
    const toggle = document.querySelector('.theme-toggle')
    const main = document.querySelector('main')
    if (!(toggle instanceof HTMLElement) || !(main instanceof HTMLElement)) {
      throw new Error('root control layout is missing')
    }
    return {
      position: getComputedStyle(toggle).position,
      toggleBottom: toggle.getBoundingClientRect().bottom,
      mainTop: main.getBoundingClientRect().top,
    }
  })

  expect(layout.position).toBe('static')
  expect(layout.toggleBottom).toBeLessThanOrEqual(layout.mainTop)
})

test('the room media canvas stays midnight in both themes while chrome follows', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '412345678901234567',
    username: 'canvas-theme-host',
    global_name: 'Canvas Theme Host',
    avatar: 'canvas-theme-host-avatar',
    email: 'canvas-theme-host@example.test',
    verified: true,
  })
  const roomPage = await signedIn.context.newPage()
  await roomPage.goto('/')
  await roomPage
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = roomPage.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill('Canvas theme room')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await roomPage.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const roomId = new URL(roomPage.url()).pathname.split('/').at(-1)
  await expect(roomPage.locator('[data-room-state="admitted"]')).toBeVisible()

  const surfaces = () =>
    roomPage.evaluate(() => {
      const read = (selector: string, property: string) => {
        const node = document.querySelector(selector)
        if (!node) throw new Error(`${selector} is missing`)
        return getComputedStyle(node).getPropertyValue(property)
      }
      // A `.room-mosaic__video` only exists while a stream is up, and headless
      // Chromium cannot grant `getDisplayMedia`. The letterbox colour is still
      // read off a real video element in the real cascade — just one this test
      // puts on the tile itself.
      const probe = document.createElement('video')
      probe.className = 'room-mosaic__video'
      const presence = document.querySelector('.room-mosaic__presence')
      if (!presence) throw new Error('.room-mosaic__presence is missing')
      presence.append(probe)
      const video = getComputedStyle(probe).backgroundColor
      probe.remove()

      return {
        theme: document.documentElement.dataset.theme ?? '',
        canvas: read('.room-stage__canvas', 'background-image'),
        presence: read('.room-mosaic__presence', 'background-image'),
        video,
        onCanvasText: read('.room-mosaic-region__empty', 'color'),
        shelf: read('.room-shelf', 'background-color'),
        dock: read('.room-dock', 'background-color'),
        footer: read('.room-mosaic__footer', 'background-color'),
      }
    })

  try {
    const toggle = roomPage.locator('.home-navigation > .theme-toggle')
    await expect(toggle).toBeVisible()
    const first = await surfaces()
    await toggle.click()
    await expect(roomPage.locator('html')).not.toHaveAttribute(
      'data-theme',
      first.theme,
    )
    const second = await surfaces()

    // ADR 0100: the media surfaces stay midnight in both themes…
    expect(second.canvas).toBe(first.canvas)
    expect(second.presence).toBe(first.presence)
    expect(second.video).toBe(first.video)
    expect(second.onCanvasText).toBe(first.onCanvasText)
    // …the letterbox is the canvas token, never pure black (ADR 0096)…
    expect(first.video).toBe('rgb(13, 20, 34)')
    // …and the room chrome still answers to the selected theme.
    expect(second.shelf).not.toBe(first.shelf)
    expect(second.dock).not.toBe(first.dock)
    expect(second.footer).not.toBe(first.footer)
  } finally {
    await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
    await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
  }
})

test('reduced motion removes animated transforms without breaking layout transforms', async ({
  authSessions,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(authSessions.origin)

  const motion = await page.evaluate(() => {
    const animated = document.createElement('div')
    animated.className = 'live-pulse motion-transform'
    const staticLayout = document.createElement('div')
    staticLayout.style.transform = 'translateX(4px)'
    document.body.append(animated, staticLayout)
    const animatedStyle = getComputedStyle(animated)
    return {
      animationName: animatedStyle.animationName,
      animatedTransform: animatedStyle.transform,
      staticTransform: getComputedStyle(staticLayout).transform,
      transitionDuration: animatedStyle.transitionDuration,
    }
  })

  expect(motion.animationName).toBe('none')
  expect(motion.animatedTransform).toBe('none')
  expect(motion.staticTransform).not.toBe('none')
  expect(motion.transitionDuration).toBe('0s')
})
