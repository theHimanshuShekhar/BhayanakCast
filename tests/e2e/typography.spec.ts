import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'

const ACCEPTED_FONT_SIZES = [13, 14, 16, 18, 24, 30, 36]

async function renderedOffScaleText(page: Page) {
  return page.locator('body').evaluate((body, accepted) => {
    return Array.from(body.querySelectorAll<HTMLElement>('*')).flatMap((node) => {
      const hasOwnText = Array.from(node.childNodes).some(
        (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
      )
      if (!hasOwnText || node.getClientRects().length === 0) return []

      const style = getComputedStyle(node)
      const size = Number.parseFloat(style.fontSize)
      if (
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0 ||
        accepted.includes(size)
      ) {
        return []
      }

      return [
        {
          element: node.tagName.toLowerCase(),
          className: node.className,
          size,
          text: node.textContent?.trim().slice(0, 80),
        },
      ]
    })
  }, ACCEPTED_FONT_SIZES)
}

for (const scenario of [
  { name: 'wide light', colorScheme: 'light' as const, width: 1440, height: 1000 },
  { name: 'wide dark', colorScheme: 'dark' as const, width: 1440, height: 1000 },
  { name: 'mobile light', colorScheme: 'light' as const, width: 390, height: 844 },
  { name: 'mobile dark', colorScheme: 'dark' as const, width: 390, height: 844 },
]) {
  test(`Home renders only the accepted typography scale at ${scenario.name}`, async ({
    authSessions,
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scenario.colorScheme })
    await page.setViewportSize({ width: scenario.width, height: scenario.height })
    await page.goto(authSessions.origin)
    await expect(page.getByRole('region', { name: 'Live Rooms' })).toBeVisible()

    expect(await renderedOffScaleText(page)).toEqual([])
  })
}

test('compact Room typography remains on-scale and operable at 200% zoom', async ({
  authSessions,
}) => {
  const signedIn = await authSessions.createBrowserContext({
    id: '712345678901234567',
    username: 'typography-host',
    global_name: 'Typography Host With A Long Display Name',
    avatar: 'typography-host-avatar',
    email: 'typography-host@example.test',
    verified: true,
  })
  const page = await signedIn.context.newPage()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill('A long typography room name for zoom')
  await dialog.getByLabel('Description').fill(
    'A compact description that exercises the admitted Room header at browser zoom.',
  )
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const roomId = new URL(page.url()).pathname.split('/').at(-1)

  try {
    await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2'
    })

    expect(await renderedOffScaleText(page)).toEqual([])
    await expect(page.getByRole('button', { name: 'Start Stream' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true)
  } finally {
    if (roomId) {
      await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
      await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
    }
    await signedIn.context.close()
  }
})
