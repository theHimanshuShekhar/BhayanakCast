import type { Browser, BrowserContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'

const stages = [
  { name: 'small', width: 390, left: 0, right: 0 },
  { name: 'medium', width: 1024, left: 72, right: 0 },
  { name: 'wide', width: 1440, left: 216, right: 280 },
] as const
const themes = ['light', 'dark'] as const

async function setTheme(context: BrowserContext, theme: (typeof themes)[number]) {
  await context.addInitScript((value) => {
    localStorage.setItem('bhayanakcast.theme', value)
  }, theme)
}

async function openAnonymous(
  browser: Browser,
  origin: string,
  width: number,
  theme: (typeof themes)[number],
  height = 800,
) {
  const context = await browser.newContext({
    baseURL: origin,
    colorScheme: theme,
    viewport: { width, height },
  })
  await setTheme(context, theme)
  const page = await context.newPage()
  await page.goto('/')
  return { context, page }
}

async function expectShell(page: Page, stage: (typeof stages)[number]) {
  const shell = page.getByTestId('home-shell')
  const left = page.getByTestId('home-navigation')
  const right = page.getByTestId('home-rail')
  const top = page.getByTestId('home-top-bar')
  const bottom = page.getByTestId('home-bottom-navigation')

  await expect(shell).toBeVisible()
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('banner', { name: 'BhayanakCast' })).toHaveCount(1)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(1)
  await expect(page.getByRole('main').getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Live Rooms' })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Past Streams' })).toHaveCount(1)
  await expect(page.getByRole('search', { name: 'Find rooms and people' })).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.locator('.theme-toggle')).toHaveCount(1)

  const order = await page.locator('[data-home-center-region]').evaluateAll((regions) =>
    regions.map((region) => region.getAttribute('data-home-center-region')),
  )
  expect(order).toEqual(['search', 'live-rooms', 'past-streams'])

  if (stage.name === 'small') {
    await expect(top).toBeVisible()
    await expect(bottom).toBeVisible()
    await expect(left).toHaveCSS('position', 'static')
    await expect(right).toHaveCSS('display', 'contents')
    expect(await top.evaluate((node) => getComputedStyle(node).position)).toBe('fixed')
    expect(await bottom.evaluate((node) => getComputedStyle(node).position)).toBe('fixed')
    expect(Math.round((await top.boundingBox())?.height ?? 0)).toBe(56)
    expect(Math.round((await bottom.boundingBox())?.height ?? 0)).toBe(64)
  } else {
    await expect(top).toHaveCSS('display', 'contents')
    await expect(bottom).toHaveCSS('display', 'contents')
    await expect(left).toBeVisible()
    expect(Math.round((await left.boundingBox())?.width ?? 0)).toBe(stage.left)
    if (stage.name === 'wide') {
      await expect(right).toBeVisible()
      expect(Math.round((await right.boundingBox())?.width ?? 0)).toBe(stage.right)
    } else {
      await expect(right).toHaveCSS('display', 'contents')
    }
  }

  const statisticsToggle = page.getByRole('button', { name: 'Clubhouse statistics' })
  const liveRoomsMetric = page.locator('.home-statistics dt', { hasText: 'Live Rooms' })
  if (stage.name === 'wide') {
    await expect(statisticsToggle).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible()
    await expect(liveRoomsMetric).toBeVisible()
  } else {
    await expect(statisticsToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(liveRoomsMetric).toBeHidden()
    await statisticsToggle.click()
    await expect(statisticsToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(liveRoomsMetric).toBeVisible()
    await statisticsToggle.click()
  }

  const scrollContract = await page.evaluate(() => {
    const nested = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const style = getComputedStyle(element)
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight
      })
      .map((element) => element.className)
    return {
      bodyOverflow: getComputedStyle(document.body).overflowY,
      nested,
      scrollingElement: document.scrollingElement === document.documentElement,
    }
  })
  expect(scrollContract.scrollingElement).toBe(true)
  expect(scrollContract.bodyOverflow).not.toMatch(/auto|scroll/)
  expect(scrollContract.nested).toEqual([])

  const scrollPadding = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return {
      bottom: Number.parseFloat(style.scrollPaddingBottom),
      top: Number.parseFloat(style.scrollPaddingTop),
    }
  })
  if (stage.name === 'small') {
    expect(scrollPadding.top).toBeGreaterThanOrEqual(72)
    expect(scrollPadding.bottom).toBeGreaterThanOrEqual(88)
  } else {
    expect(scrollPadding.top).toBeGreaterThanOrEqual(16)
    expect(scrollPadding.bottom).toBeGreaterThanOrEqual(16)
  }

  const hiddenDuplicates = await page.evaluate(() => {
    const controls = [...document.querySelectorAll<HTMLElement>('a[href], button, input')]
    const label = (element: HTMLElement) =>
      element.getAttribute('aria-label')?.trim() || element.textContent?.trim() || ''
    const visibleLabels = controls
      .filter((element) => element.getClientRects().length > 0)
      .map(label)
      .filter(Boolean)
    return controls
      .filter((element) => {
        if (element.getClientRects().length > 0) return false
        for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
          if (getComputedStyle(ancestor).display === 'none') return false
          if (ancestor.matches('[popover]:not(:popover-open)')) return false
        }
        return true
      })
      .map(label)
      .filter((value) => value && visibleLabels.includes(value))
  })
  expect(hiddenDuplicates).toEqual([])
}

async function expectKeyboardOrder(
  page: Page,
  expected: readonly string[],
  expectTooltips = false,
) {
  await page.evaluate(() => {
    const sentinel = document.createElement('button')
    sentinel.id = 'keyboard-order-sentinel'
    sentinel.style.cssText =
      'position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:0.01'
    document.body.prepend(sentinel)
  })
  await page.locator('#keyboard-order-sentinel').click({ force: true })
  for (const label of expected) {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null
      if (!element) return null
      const style = getComputedStyle(element)
      const tooltipStyle = getComputedStyle(element, '::after')
      return {
        label:
          element.getAttribute('aria-label') ||
          (element instanceof HTMLInputElement
            ? element.labels?.[0]?.textContent?.trim()
            : undefined) ||
          element.textContent?.trim() ||
          element.tagName,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        visible: element.getClientRects().length > 0,
        hasTooltip: tooltipStyle.content !== 'none',
      }
    })
    expect(focused?.visible).toBe(true)
    expect(focused?.label, `${page.viewportSize()?.width}px expected ${label}`).toContain(label)
    expect(focused?.outlineWidth).toBeGreaterThan(0)
    if (expectTooltips && focused?.hasTooltip) {
      await expect
        .poll(() =>
          page.evaluate(() =>
            Number.parseFloat(getComputedStyle(document.activeElement!, '::after').opacity),
          ),
        )
        .toBe(1)
    }
  }
  await page.evaluate(() => document.querySelector('#keyboard-order-sentinel')?.remove())
}

async function expectMediumTooltips(page: Page) {
  const controls = page.getByTestId('home-navigation').locator('[data-tooltip]:visible')
  const count = await controls.count()
  expect(count).toBeGreaterThanOrEqual(4)
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index)
    await control.hover()
    const content = await control.evaluate(
      (element) => getComputedStyle(element, '::after').content,
    )
    expect(content).not.toBe('none')
    expect(content).not.toBe('""')
    await expect
      .poll(() =>
        control.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element, '::after').opacity),
        ),
      )
      .toBe(1)
  }
}

function anonymousKeyboardOrder(stage: (typeof stages)[number], theme: (typeof themes)[number]) {
  const profile = stage.name === 'small' ? ['Profile — sign in with Discord'] : []
  const account = stage.name === 'wide' ? [] : ['Sign in with Discord']
  const utilities = stage.name === 'wide' ? ['Sign in with Discord'] : ['Clubhouse statistics']
  return [
    'Home',
    'Create room',
    ...profile,
    theme === 'light' ? 'Dark theme' : 'Light theme',
    ...account,
    'Find rooms and people',
    ...utilities,
  ]
}

function authenticatedKeyboardOrder(stage: (typeof stages)[number], theme: (typeof themes)[number]) {
  const profile = stage.name === 'small' ? ['Profile'] : []
  return [
    'Home',
    'Create room',
    ...profile,
    theme === 'light' ? 'Dark theme' : 'Light theme',
    'Home Shell Member account',
    'Find rooms and people',
    stage.name === 'wide' ? 'Start a room' : 'Clubhouse statistics',
  ]
}

test('anonymous Home shell keeps one responsive tree in both themes', async ({
  authSessions,
  browser,
}) => {
  for (const theme of themes) {
    for (const stage of stages) {
      const { context, page } = await openAnonymous(
        browser,
        authSessions.origin,
        stage.width,
        theme,
      )
      try {
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expectShell(page, stage)
        await expect(page.getByRole('button', { name: 'Sign in with Discord', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0)
        await expect(page.getByText(/accounts? connected/i)).toBeVisible()
        await expectKeyboardOrder(page, anonymousKeyboardOrder(stage, theme), stage.name === 'medium')
        if (stage.name === 'medium') await expectMediumTooltips(page)
      } finally {
        await context.close()
      }
    }
  }
})

test('small Home shell honors nonzero safe-area insets', async ({ authSessions, browser }) => {
  const context = await browser.newContext({
    baseURL: authSessions.origin,
    viewport: { width: 390, height: 800 },
  })
  const page = await context.newPage()
  await page.goto('/')
  await page.addStyleTag({
    content:
      ':root{--safe-area-top:24px;--safe-area-right:20px;--safe-area-bottom:18px;--safe-area-left:12px}',
  })

  expect(Math.round((await page.getByTestId('home-top-bar').boundingBox())?.height ?? 0)).toBe(80)
  expect(Math.round((await page.getByTestId('home-bottom-navigation').boundingBox())?.height ?? 0)).toBe(82)
  const insets = await page.getByTestId('home-shell').evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      top: Number.parseFloat(style.paddingTop),
      right: Number.parseFloat(style.paddingRight),
      bottom: Number.parseFloat(style.paddingBottom),
      left: Number.parseFloat(style.paddingLeft),
    }
  })
  expect(insets).toEqual({ top: 96, right: 20, bottom: 106, left: 16 })
  await context.close()
})

test('authenticated Home shell exposes the account popout at every stage', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '102938475610293899',
    username: 'home-shell',
    global_name: 'Home Shell Member',
    avatar: 'home-shell-avatar',
    email: 'home-shell@example.test',
    verified: true,
  })
  const page = await signedIn.context.newPage()

  for (const theme of themes) {
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate((value) => localStorage.setItem('bhayanakcast.theme', value), theme).catch(() => undefined)
    for (const stage of stages) {
      await page.setViewportSize({ width: stage.width, height: 800 })
      await page.goto('/')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expectShell(page, stage)
      await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
      const account = page.getByRole('button', { name: 'Home Shell Member account' })
      await expect(account).toBeVisible()
      const profileNavigation = page
        .getByTestId('home-bottom-navigation')
        .getByRole('link', { name: 'Profile', exact: true })
      if (stage.name === 'small') {
        await expect(profileNavigation).toHaveAttribute('href', '/profile')
      } else {
        await expect(profileNavigation).toHaveCount(0)
      }
      await account.click()
      await expect(account).toHaveAttribute('aria-expanded', 'true')
      const accountMenu = page.getByRole('menu')
      await expect(accountMenu.getByRole('menuitem', { name: 'Profile', exact: true })).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(accountMenu.getByRole('menuitem', { name: 'Log out' })).toBeFocused()
      await expect(
        accountMenu.getByRole('menuitem', { name: 'Profile', exact: true }),
      ).toHaveAttribute('href', '/profile')
      await page.keyboard.press('Tab')
      await expect(accountMenu).toHaveCount(0)
      await account.click()
      await expect(accountMenu.getByRole('menuitem', { name: 'Profile', exact: true })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(accountMenu).toHaveCount(0)
      await expect(account).toBeFocused()
      await account.click()
      await page.keyboard.press('Escape')
      await expect(account).toBeFocused()
      await expectKeyboardOrder(
        page,
        authenticatedKeyboardOrder(stage, theme),
        stage.name === 'medium',
      )
      if (stage.name === 'medium') await expectMediumTooltips(page)
    }
  }
})

test('authenticated account control is present in server-rendered HTML', async ({
  authSessions,
  browser,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '102938475610293901',
    username: 'ssr-shell',
    global_name: 'SSR Shell Member',
    avatar: null,
    email: 'ssr-shell@example.test',
    verified: true,
  })
  const context = await browser.newContext({
    baseURL: authSessions.origin,
    javaScriptEnabled: false,
    storageState: await signedIn.context.storageState(),
  })
  const page = await context.newPage()
  const response = await page.goto('/')
  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('button', { name: 'SSR Shell Member account' })).toBeVisible()
  const html = await response!.text()
  expect(html).toContain('SSR Shell Member')
  expect(html).not.toContain('ssr-shell@example.test')
  expect(html).not.toContain('102938475610293901')
  expect(html).not.toContain('ssr-shell')
  await context.close()
})

test('Admin navigation is visible only to an authorized Account', async ({ authSessions }) => {
  const admin = await authSessions.createBrowserContext({
    id: '102938475610293900',
    username: 'home-admin',
    global_name: 'Home Admin',
    avatar: 'home-admin-avatar',
    email: 'home-admin@example.test',
    verified: true,
  })
  await setTheme(admin.context, 'light')
  const page = await admin.context.newPage()
  for (const stage of stages) {
    await page.setViewportSize({ width: stage.width, height: 800 })
    await page.goto('/')
    await expectShell(page, stage)
    await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveAttribute(
      'href',
      '/admin',
    )
    if (stage.name === 'small') {
      const columns = await page
        .getByTestId('home-bottom-navigation')
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
      expect(columns).toBe(4)
    }
    const profile = stage.name === 'small' ? ['Profile'] : []
    await expectKeyboardOrder(
      page,
      [
        'Home',
        'Create room',
        ...profile,
        'Admin',
        'Dark theme',
        'Home Admin account',
        'Find rooms and people',
        stage.name === 'wide' ? 'Start a room' : 'Clubhouse statistics',
      ],
      stage.name === 'medium',
    )
  }
})

test('query mode replaces Past Streams with Profiles without duplicating Home', async ({
  authSessions,
  browser,
}) => {
  const { context, page } = await openAnonymous(browser, authSessions.origin, 1024, 'light')
  try {
    await page.goto('/?q=member')
    await expect(page.getByRole('heading', { name: 'Live Rooms' })).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Public Profiles' })).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Past Streams' })).toHaveCount(0)
    const order = await page.locator('[data-home-center-region]').evaluateAll((regions) =>
      regions.map((region) => region.getAttribute('data-home-center-region')),
    )
    expect(order).toEqual(['search', 'live-rooms', 'profiles'])
    const activeScrollPadding = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
    )
    expect(activeScrollPadding).toBeGreaterThanOrEqual(208)
  } finally {
    await context.close()
  }
})

test('desktop companions rejoin document flow in a short viewport', async ({
  authSessions,
  browser,
}) => {
  const { context, page } = await openAnonymous(
    browser,
    authSessions.origin,
    1440,
    'light',
    560,
  )
  try {
    await expect(page.getByTestId('home-navigation')).toHaveCSS('position', 'static')
    await expect(page.getByTestId('home-rail')).toHaveCSS('position', 'static')
    const nestedScrolls = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
        const style = getComputedStyle(element)
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight
      }).length,
    )
    expect(nestedScrolls).toBe(0)
  } finally {
    await context.close()
  }
})
