import { expect, test } from '@playwright/test'

const STORAGE_KEY = 'bhayanakcast.theme'

test('follows the system theme and ignores an invalid override', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript((key) => localStorage.setItem(key, 'sepia'), STORAGE_KEY)

  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    '#0D1422',
  )
})

test('a persisted light override wins over a dark system before readiness', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript((key) => localStorage.setItem(key, 'light'), STORAGE_KEY)

  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    '#F6F8FC',
  )
})

test('theme controls work when browser storage access is denied', async ({
  page,
}) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage access denied', 'SecurityError')
      },
    })
  })

  await page.goto('/')
  await page.emulateMedia({ colorScheme: 'dark' })

  const toggle = page.getByRole('button', { name: 'Dark theme' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(pageErrors).toEqual([])
})

test('the visible toggle persists an anonymous override across reloads', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  const toggle = page.getByRole('button', { name: 'Dark theme' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
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
})

test('applies the theme in the head before document readiness', async ({
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
  await page.goto('/')

  await expect(page.locator('script[data-theme-bootstrap]')).toHaveCount(1)
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme-at-ready',
    'dark',
  )
})

test('publishes the root metadata contract', async ({ page }) => {
  await page.goto('/')

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
  page,
}) => {
  await page.goto('/')

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

test('reduced motion removes animated transforms without breaking layout transforms', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

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
