import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { AuthSessionFixture } from './fixtures'

async function seedSearch(authSessions: AuthSessionFixture) {
  const accountId = randomUUID()
  const roomId = randomUUID()
  await authSessions.sql(
    `INSERT INTO "user" (id, name, email, image, email_verified, created_at, updated_at)
     VALUES ($1, 'Atlas Member', $2, '/test-assets/atlas.png', false, now(), now())`,
    [accountId, `${accountId}@example.test`],
  )
  await authSessions.sql(
    `INSERT INTO room (id, name, category, tags, visibility, created_at)
     VALUES ($1, 'Atlas Studio', 'Art', ARRAY['drawing', 'friends', '2026'], 'public', now() - interval '1 hour')`,
    [roomId],
  )
  await authSessions.sql(
    `INSERT INTO room_membership (id, room_id, account_id, role, joined_at)
     VALUES ($1, $2, $3, 'member', now() - interval '30 minutes')`,
    [randomUUID(), roomId, accountId],
  )
  return { accountId, roomId }
}

function searchParams(page: Page) {
  return new URL(page.url()).searchParams
}

test('debounces text into replace-history URLs and Enter flushes immediately', async ({
  authSessions,
  page,
}) => {
  await seedSearch(authSessions)
  await page.goto(authSessions.origin)
  const input = page.getByRole('searchbox', { name: 'Find rooms and people' })
  const initialHistoryLength = await page.evaluate(() => history.length)

  await input.fill('Atlas')
  await page.waitForTimeout(125)
  expect(searchParams(page).get('q')).toBeNull()
  await expect(page.getByRole('status', { name: 'Search pending' })).toBeVisible()

  await input.press('Enter')
  await expect.poll(() => searchParams(page).get('q')).toBe('Atlas')
  await expect(input).toBeFocused()

  await input.fill('Atlas Member')
  await expect.poll(() => searchParams(page).get('q')).toBe('Atlas Member')
  expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength)
  await page.reload()
  await expect(input).toHaveValue('Atlas Member')
  await input.fill('Late query')
  await page.getByRole('button', { name: 'Clear all' }).click()
  await page.waitForTimeout(300)
  expect(new URL(page.url()).search).toBe('')
  await expect(input).toHaveValue('')
})

test('restores shared, back, and forward URLs before rendering results', async ({
  authSessions,
  page,
}) => {
  await seedSearch(authSessions)
  await page.goto(`${authSessions.origin}/?q=Atlas`)
  const input = page.getByRole('searchbox', { name: 'Find rooms and people' })
  await expect(input).toHaveValue('Atlas')
  await expect(page.getByRole('heading', { name: 'Active Rooms' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Public Profiles' })).toBeVisible()

  await page.goto(`${authSessions.origin}/?q=Nobody`)
  await expect(input).toHaveValue('Nobody')
  await page.goBack()
  await expect(input).toHaveValue('Atlas')
  await page.goForward()
  await expect(input).toHaveValue('Nobody')
})

test('applies desktop filters immediately and clears canonical search state', async ({
  authSessions,
  page,
}) => {
  await seedSearch(authSessions)
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto(authSessions.origin)
  const utilities = page.locator('.home-search-utilities')
  await expect(utilities).toHaveCSS('position', 'relative')

  const category = page.getByRole('combobox', { name: 'Category' })
  await category.fill('Art')
  await expect.poll(() => searchParams(page).get('category')).toBe('Art')
  await expect(utilities).toHaveCSS('position', 'sticky')
  await expect(page.getByRole('button', { name: 'Remove category Art' })).toBeVisible()

  const tags = page.getByRole('combobox', { name: 'Add tag' })
  await tags.fill('drawing')
  await expect.poll(() => searchParams(page).getAll('tags')).toEqual(['drawing'])
  await expect(page.getByRole('button', { name: 'Remove tag drawing' })).toBeVisible()
  await tags.fill('2026')
  await expect.poll(() => searchParams(page).getAll('tags')).toEqual([
    '2026',
    'drawing',
  ])
  await expect(page.getByRole('button', { name: 'Remove tag 2026' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Remove tag 2026' })).toBeVisible()

  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect.poll(() => new URL(page.url()).search).toBe('')
  await expect(utilities).toHaveCSS('position', 'relative')
  await expect(page.getByRole('heading', { name: 'Live Rooms' })).toBeVisible()
})

test('renders compact bounded result groups and a native mobile filter sheet', async ({
  authSessions,
  page,
}) => {
  const { accountId, roomId } = await seedSearch(authSessions)
  await page.goto(`${authSessions.origin}/?q=Atlas`)

  const rooms = page.locator('.room-search-result')
  const profiles = page.locator('.profile-search-result')
  await expect(rooms).toHaveCount(1)
  await expect(profiles).toHaveCount(1)
  await expect(rooms.getByRole('link')).toHaveAttribute('href', `/rooms/${roomId}`)
  await expect(rooms.locator('button')).toHaveCount(0)
  await expect(profiles.getByRole('link')).toHaveAttribute('href', `/users/${accountId}`)
  await expect(profiles.locator('button')).toHaveCount(0)
  await expect(page.getByRole('status', { name: 'Search result count' })).toContainText(
    '1 active room and 1 public profile',
  )

  const input = page.getByRole('searchbox', { name: 'Find rooms and people' })
  await input.focus()
  await input.fill('No matching identity')
  await expect(page.getByText('No active rooms match this search.')).toBeVisible()
  await expect(page.getByText('No public profiles match this search.')).toBeVisible()
  await expect(input).toBeFocused()

  await page.setViewportSize({ width: 390, height: 800 })
  await page.getByRole('button', { name: 'Filters' }).click()
  const sheet = page.getByRole('dialog', { name: 'Filters' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('combobox', { name: 'Category' }).fill('Art')
  await expect.poll(() => searchParams(page).get('category')).toBe('Art')
  await sheet.getByRole('button', { name: 'Close filters' }).click()
  await expect(sheet).not.toBeVisible()
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390)
})
