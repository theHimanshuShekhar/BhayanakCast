import { randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'

const stages = [
  { name: 'small', width: 390 },
  { name: 'medium', width: 1024 },
  { name: 'wide', width: 1440 },
] as const
const themes = ['light', 'dark'] as const
const PROFILE = {
  id: '390102414401440001',
  username: 'profile-responsive',
  global_name: 'A very long Discord display name that must wrap safely',
  avatar: null,
  email: 'profile-responsive@example.test',
  verified: true,
} as const

async function configurePage(
  context: BrowserContext,
  page: Page,
  stage: (typeof stages)[number],
  theme: (typeof themes)[number],
) {
  await page.setViewportSize({ width: stage.width, height: 800 })
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await context.addInitScript((value) => {
    localStorage.setItem('bhayanakcast.theme', value)
  }, theme)
}

async function openProfile(
  browser: Browser,
  origin: string,
  stage: (typeof stages)[number],
  theme: (typeof themes)[number],
) {
  const context = await browser.newContext({ baseURL: origin, colorScheme: theme })
  const page = await context.newPage()
  await configurePage(context, page, stage, theme)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  return { context, page }
}

test('authenticated Profile keeps navigation and content contained across responsive stages', async ({
  authSessions,
  browser,
}) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const state = await signedIn.context.storageState()
  await signedIn.context.close()

  for (const theme of themes) {
    for (const stage of stages) {
      const context = await browser.newContext({
        baseURL: authSessions.origin,
        colorScheme: theme,
        storageState: state,
      })
      const page = await context.newPage()
      await configurePage(context, page, stage, theme)
      await page.goto('/profile')

      try {
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
        await expect(page.getByRole('heading', { name: PROFILE.global_name, exact: true })).toBeVisible()
        for (const heading of ['Public activity', 'Theme preference', 'Muted accounts', 'Account deletion']) {
          await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
        }
        await expect(page.getByRole('button', { name: /theme$/i })).toHaveCount(1)

        const identity = page.locator('.public-profile__identity h2')
        await expect(identity).toHaveCSS('overflow-wrap', 'anywhere')
        const identityContained = await identity.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const parent = element.closest('.public-profile__identity')?.getBoundingClientRect()
          return Boolean(parent && bounds.right <= parent.right + 1 && element.scrollWidth <= element.clientWidth)
        })
        expect(identityContained).toBe(true)

        const scrollContract = await page.evaluate(() => ({
          bodyOverflow: getComputedStyle(document.body).overflowY,
          nested: [...document.querySelectorAll<HTMLElement>('body *')]
            .filter((element) => {
              const style = getComputedStyle(element)
              return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight
            })
            .map((element) => element.className),
          scrollingElement: document.scrollingElement === document.documentElement,
        }))
        expect(scrollContract.scrollingElement).toBe(true)
        expect(scrollContract.bodyOverflow).not.toMatch(/auto|scroll/)
        expect(scrollContract.nested).toEqual([])

        if (stage.name === 'small') {
          const navigation = page.getByTestId('profile-navigation')
          await expect(navigation).toBeVisible()
          await expect(navigation.getByTestId('home-top-bar')).toBeVisible()
          await expect(navigation.getByTestId('home-bottom-navigation')).toBeVisible()
          await expect(navigation.getByRole('link', { name: 'Profile', exact: true })).toHaveAttribute(
            'aria-current',
            'page',
          )
          await expect(navigation.getByRole('link', { name: 'Home', exact: true })).not.toHaveAttribute(
            'aria-current',
            'page',
          )
          await expect(page.locator('.public-profile__home')).toBeHidden()
          await expect(page.locator('.profile-desktop-account')).toBeHidden()
          await page.addStyleTag({
            content:
              ':root{--safe-area-top:24px;--safe-area-right:20px;--safe-area-bottom:18px;--safe-area-left:12px}',
          })
          const safeArea = await page.getByTestId('home-top-bar').evaluate((element) => ({
            height: Math.round(element.getBoundingClientRect().height),
            paddingLeft: Number.parseFloat(getComputedStyle(element).paddingLeft),
            profilePaddingBottom: Number.parseFloat(
              getComputedStyle(document.querySelector('.public-profile')!).paddingBottom,
            ),
          }))
          expect(safeArea.height).toBe(80)
          expect(safeArea.paddingLeft).toBe(16)
          expect(safeArea.profilePaddingBottom).toBe(106)
          await expect(page.getByTestId('profile-navigation').locator('.theme-toggle')).toHaveCSS(
            'transition-duration',
            '0s',
          )
          expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
          const requestButton = page.getByRole('button', { name: 'Request account deletion' })
          await requestButton.evaluate((element) => element.scrollIntoView({ block: 'center' }))
          const requestClearance = await requestButton.evaluate((element) => {
            const navigation = document.querySelector<HTMLElement>('[data-testid="home-bottom-navigation"]')
            const buttonBox = element.getBoundingClientRect()
            const navigationBox = navigation?.getBoundingClientRect()
            return navigationBox ? buttonBox.bottom <= navigationBox.top : false
          })
          expect(requestClearance).toBe(true)
        } else {
          await expect(page.getByTestId('profile-navigation')).toBeHidden()
          await expect(page.locator('.public-profile__home')).toBeVisible()
          await expect(page.locator('.profile-desktop-account')).toBeVisible()
          await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden()
        }

        const accountButtons = page.getByRole('button', { name: `${PROFILE.global_name} account` })
        await expect(accountButtons).toHaveCount(1)
        await expect(accountButtons).toBeVisible()
        await accountButtons.click()
        const menu = page.getByRole('menu')
        await expect(menu).toBeVisible()
        await expect(menu.getByRole('menuitem', { name: 'Profile', exact: true })).toBeFocused()
        if (stage.name !== 'small') {
          const triggerBox = await accountButtons.boundingBox()
          const popoverBox = await menu.boundingBox()
          expect(triggerBox).not.toBeNull()
          expect(popoverBox).not.toBeNull()
          expect(popoverBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height - 1)
          expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(stage.width)
          expect(
            Math.abs(
              popoverBox!.x + popoverBox!.width - (triggerBox!.x + triggerBox!.width),
            ),
          ).toBeLessThanOrEqual(2)
        }
        await page.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
        await expect(accountButtons).toBeFocused()

        await page.getByRole('combobox', { name: 'Theme preference' }).focus()
        await expect(page.getByRole('combobox', { name: 'Theme preference' })).toBeFocused()
        await page.getByRole('button', { name: 'Request account deletion' }).focus()
        await expect(page.getByRole('button', { name: 'Request account deletion' })).toBeFocused()
      } finally {
        await context.close()
      }
    }
  }
})

test('anonymous direct Profile access keeps the Discord gate and one document scroll', async ({
  authSessions,
  browser,
}) => {
  const { context, page } = await openProfile(browser, authSessions.origin, stages[0], 'light')
  try {
    await expect(page.getByText('Sign in to see your public activity and account details.', { exact: true })).toBeVisible()
    // Scoped to the gate: the navigation rail carries its own sign-in control
    // with the same accessible name, and this assertion is about the gate.
    await expect(
      page.getByRole('main').getByRole('button', { name: 'Continue with Discord', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: PROFILE.global_name, exact: true })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(1)
    await expect(page.getByTestId('profile-navigation')).toBeVisible()
    const anonymousProfileItem = page.getByTestId('profile-navigation').locator('.home-nav-item--profile')
    await expect(anonymousProfileItem).toHaveAttribute('aria-current', 'page')
    await expect(anonymousProfileItem).toHaveClass(/home-nav-item--current/)
  } finally {
    await context.close()
  }
})

test('active Profile state has a stable responsive visual baseline', async ({ authSessions, browser }) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const state = await signedIn.context.storageState()
  await signedIn.context.close()
  const context = await browser.newContext({
    baseURL: authSessions.origin,
    colorScheme: 'light',
    storageState: state,
    viewport: { width: 390, height: 800 },
  })
  const page = await context.newPage()
  try {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.goto('/profile')
    await expect(page).toHaveScreenshot('profile-active.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
    })
  } finally {
    await context.close()
  }
})

test('pending Profile state has a stable responsive visual baseline', async ({ authSessions, browser }) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const context = signedIn.context
  const page = await context.newPage()
  try {
    const session = await (await page.request.get(`${authSessions.origin}/api/session`)).json()
    const requestedAt = '2026-07-20T12:00:00.000Z'
    await authSessions.sql(
      `INSERT INTO deletion_request (id, account_id, status, requested_at)
       VALUES ($1, $2, 'pending', $3)`,
      [randomUUID(), session.id, requestedAt],
    )
    await authSessions.sql(
      `INSERT INTO account_state (account_id, deletion_requested_at)
       VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET deletion_requested_at = EXCLUDED.deletion_requested_at`,
      [session.id, requestedAt],
    )
    await page.setViewportSize({ width: 390, height: 800 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.goto('/profile')
    await expect(page.getByRole('region', { name: 'Account deletion' }).getByRole('status')).toContainText('Deletion request pending')
    const cancelButton = page.getByRole('button', { name: 'Cancel deletion request' })
    await cancelButton.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    const cancelClearance = await cancelButton.evaluate((element) => {
      const navigation = document.querySelector<HTMLElement>('[data-testid="home-bottom-navigation"]')
      const buttonBox = element.getBoundingClientRect()
      const navigationBox = navigation?.getBoundingClientRect()
      return navigationBox ? buttonBox.bottom <= navigationBox.top : false
    })
    expect(cancelClearance).toBe(true)
    await expect(page).toHaveScreenshot('profile-pending.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
    })
  } finally {
    await context.close()
  }
})
