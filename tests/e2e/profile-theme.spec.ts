import { expect, test, gotoHydrated } from './fixtures'

const ACCOUNT = {
  id: '564738291056473829',
  username: 'theme-member',
  global_name: 'Theme member',
  avatar: null,
  email: 'theme-member@example.test',
  verified: true,
}

const OTHER_ACCOUNT = {
  id: '918273645091827364',
  username: 'other-theme-member',
  global_name: 'Other theme member',
  avatar: null,
  email: 'other-theme-member@example.test',
  verified: true,
}

test('anonymous theme uses local override and device fallback', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await gotoHydrated(page, '/profile')
  await page.evaluate(() => localStorage.setItem('bhayanakcast.theme', 'light'))
  await gotoHydrated(page, page.url())

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.evaluate(() => localStorage.removeItem('bhayanakcast.theme'))
  await gotoHydrated(page, page.url())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('account preference updates immediately, persists, and stays isolated', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext(ACCOUNT)
  const page = await signedIn.context.newPage()
  await page.emulateMedia({ colorScheme: 'light' })
  await gotoHydrated(page, `${authSessions.origin}/profile`)

  const preference = page.getByRole('combobox', { name: 'Theme preference' })
  await expect(preference).toHaveValue('system')
  await preference.selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  const secondContext = await authSessions.createBrowserContext(ACCOUNT)
  const secondPage = await secondContext.context.newPage()
  await secondPage.emulateMedia({ colorScheme: 'light' })
  await gotoHydrated(secondPage, `${authSessions.origin}/profile`)
  await expect(secondPage.getByRole('combobox', { name: 'Theme preference' })).toHaveValue('dark')
  await expect(secondPage.locator('html')).toHaveAttribute('data-theme', 'dark')

  const otherContext = await authSessions.createBrowserContext(OTHER_ACCOUNT)
  const otherPage = await otherContext.context.newPage()
  await otherPage.emulateMedia({ colorScheme: 'light' })
  await gotoHydrated(otherPage, `${authSessions.origin}/profile`)
  await expect(otherPage.getByRole('combobox', { name: 'Theme preference' })).toHaveValue('system')
  await expect(otherPage.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('sign out returns to anonymous local theme behavior', async ({ authSessions }) => {
  const signedIn = await authSessions.createBrowserContext(ACCOUNT)
  await signedIn.context.addInitScript(() =>
    localStorage.setItem('bhayanakcast.theme', 'light'),
  )
  const page = await signedIn.context.newPage()
  await page.emulateMedia({ colorScheme: 'dark' })
  await gotoHydrated(page, `${authSessions.origin}/profile`)
  await page.getByRole('combobox', { name: 'Theme preference' }).selectOption('dark')
  await gotoHydrated(page, `${authSessions.origin}/`)
  const accountButton = page.getByRole('button', { name: 'Theme member account' })
  await expect(accountButton).toBeVisible()
  await accountButton.click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await page.waitForURL(`${authSessions.origin}/`)

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
test('account preference applies before document readiness', async ({ authSessions }) => {
  const signedIn = await authSessions.createBrowserContext(ACCOUNT)
  const page = await signedIn.context.newPage()
  const session = await (await page.request.get(`${authSessions.origin}/api/session`)).json()
  await authSessions.sql(
    `INSERT INTO account_preference (account_id, theme)
     VALUES ($1, 'dark')
     ON CONFLICT (account_id) DO UPDATE SET theme = EXCLUDED.theme`,
    [session.id],
  )
  await page.emulateMedia({ colorScheme: 'light' })
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
  await gotoHydrated(page, `${authSessions.origin}/profile`)

  await expect(page.locator('html')).toHaveAttribute('data-theme-at-ready', 'dark')
})
test('failed account update restores the previous effective theme', async ({ authSessions }) => {
  const signedIn = await authSessions.createBrowserContext(ACCOUNT)
  const page = await signedIn.context.newPage()
  await page.emulateMedia({ colorScheme: 'light' })
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await held
    await route.fulfill({ status: 500, body: 'preference unavailable' })
  })
  await gotoHydrated(page, `${authSessions.origin}/profile`)

  const preference = page.getByRole('combobox', { name: 'Theme preference' })
  await expect(preference).toHaveValue('system')
  // Programmatic select events can precede selective route hydration under load.
  // The held request makes retrying safe: only the first handled change can mutate.
  await expect(async () => {
    await preference.selectOption('dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', {
      timeout: 1_000,
    })
  }).toPass({ timeout: 15_000 })
  release()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(preference).toHaveValue('system')
})
test('failed update still restores the theme after Profile unmounts', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext(ACCOUNT)
  const page = await signedIn.context.newPage()
  const session = await (await page.request.get(`${authSessions.origin}/api/session`)).json()
  await authSessions.sql('DELETE FROM account_preference WHERE account_id = $1', [session.id])
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await held
    await route.fulfill({ status: 500, body: 'preference unavailable' })
  })
  await gotoHydrated(page, `${authSessions.origin}/profile`)
  await page.getByRole('combobox', { name: 'Theme preference' }).selectOption('dark')
  await authSessions.sql(
    `INSERT INTO account_preference (account_id, theme)
     VALUES ($1, 'dark')
     ON CONFLICT (account_id) DO UPDATE SET theme = EXCLUDED.theme`,
    [session.id],
  )
  await page.evaluate(async () => {
    await (
      window as typeof window & {
        __TSR_ROUTER__: { navigate: (options: { to: string }) => Promise<void> }
      }
    ).__TSR_ROUTER__.navigate({ to: '/' })
  })
  await expect(page).toHaveURL(`${authSessions.origin}/`)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  release()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('theme controls disable while one account update is pending', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext(ACCOUNT)
  const page = await signedIn.context.newPage()
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  await gotoHydrated(page, `${authSessions.origin}/profile`)

  const preference = page.getByRole('combobox', { name: 'Theme preference' })
  await preference.selectOption('dark')
  await expect(preference).toBeDisabled()
  await expect(page.getByRole('button', { name: /theme$/i })).toBeDisabled()
  release()
  await expect(preference).toBeEnabled()
})
