import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
// The project fixture provisions a migrated per-worker schema and its own
// server, so these cases do not depend on whoever migrated the default schema
// first the way the bare Playwright fixture does.
import { expect, test } from './fixtures'
import type { AuthSessionFixture } from './fixtures'

const HOST_PROFILE = {
  id: '271828182845904523',
  username: 'shell-host',
  global_name: 'Shell Host',
  avatar: 'shell-host-avatar',
  email: 'shell-host@example.test',
  verified: true,
}

const VISITOR_PROFILE = {
  id: '314159265358979323',
  username: 'shell-visitor',
  global_name: 'Shell Visitor',
  avatar: 'shell-visitor-avatar',
  email: 'shell-visitor@example.test',
  verified: true,
}

const DISCORD_DOOR = 'Continue with Discord'

/** The shipped route into an admitted room: create it from Home and land in it
    as Host, exactly as `create-and-open-room.spec.ts` does. */
async function createAdmittedRoom(page: Page, name: string) {
  await page.goto('/')
  await page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
  return new URL(page.url()).pathname.split('/').at(-1) as string
}

async function dropRoom(authSessions: AuthSessionFixture, roomId: string) {
  await authSessions.sql('DELETE FROM message WHERE room_id = $1', [roomId])
  const seeded = (await authSessions.sql(
    `SELECT account_id AS "accountId" FROM room_membership
     WHERE room_id = $1 AND account_id LIKE 'shell-filler-%'`,
    [roomId],
  )) as { readonly accountId: string }[]
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
  for (const { accountId } of seeded) {
    await authSessions.sql('DELETE FROM "user" WHERE id = $1', [accountId])
  }
}

/** End a room the app created. A bare `now()` is not usable here: the app
    writes created_at from the Node clock in local time while Postgres runs in
    UTC, so now() can land before creation and trip room_end_check. Specs that
    seed created_at themselves do not have that problem. */
function endRoom(authSessions: AuthSessionFixture, roomId: string) {
  return authSessions.sql(
    'UPDATE room SET ended_at = greatest(now()::timestamp, created_at) WHERE id = $1',
    [roomId],
  )
}

/** A full roster and a long chat log, so the two bounded scroll regions have
    something to scroll. Seeded directly: ten real browser sessions to prove a
    CSS clamp would cost minutes per run. */
async function fillRoom(authSessions: AuthSessionFixture, roomId: string) {
  const hostMembership = (
    (await authSessions.sql(
      'SELECT id FROM room_membership WHERE room_id = $1 LIMIT 1',
      [roomId],
    )) as { readonly id: string }[]
  )[0]?.id
  if (!hostMembership) throw new Error('Seeded room has no host membership')

  for (let index = 0; index < 9; index += 1) {
    const accountId = `shell-filler-${randomUUID()}`
    await authSessions.sql(
      `INSERT INTO "user" (id, name, email, email_verified)
       VALUES ($1, $2, $3, true)`,
      [accountId, `Filler ${index + 1}`, `${accountId}@example.test`],
    )
    await authSessions.sql(
      `INSERT INTO room_membership (id, room_id, account_id, role, joined_at)
       VALUES ($1, $2, $3, 'member', now())`,
      [randomUUID(), roomId, accountId],
    )
  }

  for (let index = 0; index < 60; index += 1) {
    await authSessions.sql(
      `INSERT INTO message (id, room_id, membership_id, body, created_at)
       VALUES ($1, $2, $3, $4, now() - ($5 * interval '1 second'))`,
      [
        randomUUID(),
        roomId,
        hostMembership,
        `Bounded scroll needs something to scroll, line ${index + 1}.`,
        60 - index,
      ],
    )
  }
}

/** Fixed surfaces sitting on the bottom edge of the viewport — ADR 0103 allows
    the admitted room exactly one. */
function bottomEdgeFixedCount(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('body *')].filter((node) => {
      const style = getComputedStyle(node)
      if (style.position !== 'fixed') return false
      if (style.display === 'none' || style.visibility === 'hidden') return false
      const box = node.getBoundingClientRect()
      return box.height > 0 && Math.abs(box.bottom - window.innerHeight) <= 1
    }).length,
  )
}

/** Every element inside the admitted boundary that is actually scrolling, by
    the two facts a scroll region is made of: an overflow that scrolls and
    content that exceeds the box. */
function scrollingRegions(page: Page) {
  return page.evaluate(() => {
    const boundary = document.querySelector('.room-boundary--admitted')
    if (!boundary) throw new Error('The admitted boundary is missing')
    return [...boundary.querySelectorAll<HTMLElement>('*')]
      .filter((node) => {
        const overflow = getComputedStyle(node).overflowY
        return (
          (overflow === 'auto' || overflow === 'scroll') &&
          node.scrollHeight - node.clientHeight > 1
        )
      })
      .map((node) => node.className)
  })
}

test('the room rail carries the viewer identity in every room state', async ({
  authSessions,
  browser,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const hostPage = await host.context.newPage()
  const roomId = await createAdmittedRoom(hostPage, 'Rail identity room')
  try {
    // Admitted.
    await expect(
      hostPage.getByRole('button', { name: 'Shell Host account' }),
    ).toBeVisible()
    await expect(hostPage.getByRole('button', { name: DISCORD_DOOR })).toHaveCount(0)

    // Pre-admission, signed in.
    const visitor = await authSessions.createBrowserContext(VISITOR_PROFILE)
    const visitorPage = await visitor.context.newPage()
    await visitorPage.goto(`/rooms/${roomId}`)
    await expect(
      visitorPage.locator('[data-room-state="pre-admission"]'),
    ).toBeVisible()
    await expect(
      visitorPage.getByRole('button', { name: 'Shell Visitor account' }),
    ).toBeVisible()
    await expect(visitorPage.getByRole('button', { name: DISCORD_DOOR })).toHaveCount(0)

    // Pre-admission, anonymous: still exactly one sign-in door and no account.
    const anonymous = await browser.newContext({ baseURL: authSessions.origin })
    try {
      const anonymousPage = await anonymous.newPage()
      await anonymousPage.goto(`/rooms/${roomId}`)
      await expect(
        anonymousPage.locator('[data-room-state="pre-admission"]'),
      ).toBeVisible()
      await expect(
        anonymousPage.getByRole('button', { name: DISCORD_DOOR }),
      ).toHaveCount(1)
      await expect(anonymousPage.locator('.home-top-account')).toHaveCount(0)
    } finally {
      await anonymous.close()
    }

    // Past Stream.
    await endRoom(authSessions, roomId)
    await visitorPage.reload()
    await expect(visitorPage.getByText('Past Stream', { exact: true })).toBeVisible()
    await expect(
      visitorPage.getByRole('button', { name: 'Shell Visitor account' }),
    ).toBeVisible()
    await expect(visitorPage.getByRole('button', { name: DISCORD_DOOR })).toHaveCount(0)
  } finally {
    await dropRoom(authSessions, roomId)
  }
})

test('a phone gets one bottom bar in an admitted room and the global one elsewhere', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const hostPage = await host.context.newPage()
  const roomId = await createAdmittedRoom(hostPage, 'One bottom bar room')
  try {
    const roomBar = hostPage.locator('.room-mobile-bar')

    // The desktop admitted room has no room bar to compete with.
    await hostPage.setViewportSize({ width: 1280, height: 800 })
    await expect(roomBar).toHaveCSS('display', 'none')

    await hostPage.setViewportSize({ width: 390, height: 844 })
    await expect(roomBar).toBeVisible()
    await expect(hostPage.getByTestId('home-bottom-navigation')).toBeHidden()
    expect(await bottomEdgeFixedCount(hostPage)).toBe(1)
    // The identity fix has to survive the suppressed navigation.
    await expect(
      hostPage.getByRole('button', { name: 'Shell Host account' }),
    ).toBeVisible()

    // Pre-admission keeps the global navigation at the same width.
    const visitor = await authSessions.createBrowserContext(VISITOR_PROFILE)
    const visitorPage = await visitor.context.newPage()
    await visitorPage.setViewportSize({ width: 390, height: 844 })
    await visitorPage.goto(`/rooms/${roomId}`)
    await expect(
      visitorPage.locator('[data-room-state="pre-admission"]'),
    ).toBeVisible()
    await expect(visitorPage.getByTestId('home-bottom-navigation')).toBeVisible()
    await expect(visitorPage.locator('.room-mobile-bar')).toHaveCount(0)

    // So does the Past Stream summary.
    await endRoom(authSessions, roomId)
    await visitorPage.reload()
    await expect(visitorPage.getByText('Past Stream', { exact: true })).toBeVisible()
    await expect(visitorPage.getByTestId('home-bottom-navigation')).toBeVisible()
    await expect(visitorPage.locator('.room-mobile-bar')).toHaveCount(0)
  } finally {
    await dropRoom(authSessions, roomId)
  }
})

test('the desktop workspace is fixed while the phone keeps document scroll', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const hostPage = await host.context.newPage()
  const roomId = await createAdmittedRoom(hostPage, 'Fixed viewport room')
  try {
    await fillRoom(authSessions, roomId)
    await hostPage.setViewportSize({ width: 1280, height: 800 })
    await hostPage.reload()
    await expect(hostPage.locator('[data-room-state="admitted"]')).toBeVisible()
    await expect(hostPage.locator('.room-mosaic__tile')).toHaveCount(10)
    // The dock hydrates its chat history after the roster, and an empty log is
    // not a scroll region: wait for the newest seeded line before measuring.
    await expect(
      hostPage.getByText('Bounded scroll needs something to scroll, line 60.'),
    ).toBeAttached()

    // One theme toggle, and the in-document root region gone: 3.5rem of it
    // above a 100dvh workspace is a document scroll on its own.
    await expect(hostPage.locator('.root-controls')).toBeHidden()
    await expect(hostPage.locator('.theme-toggle:visible')).toHaveCount(1)

    // The document itself does not scroll.
    await expect
      .poll(() =>
        hostPage.evaluate(
          () =>
            document.documentElement.scrollHeight -
            document.documentElement.clientHeight,
        ),
      )
      .toBeLessThanOrEqual(1)

    // Two bounded scroll regions, and the mosaic is not one of them — nesting a
    // second scroller in the canvas column puts two scrollbars on one list.
    const regions = await scrollingRegions(hostPage)
    expect(regions).toHaveLength(2)
    expect(regions.some((name) => name.includes('room-stage__canvas'))).toBe(true)
    expect(regions.some((name) => name.includes('room-dock__panel'))).toBe(true)
    expect(regions.some((name) => name.split(/\s+/).includes('room-mosaic'))).toBe(
      false,
    )

    // The mosaic scrolls before a tile falls below ADR 0100's 240px floor.
    const tileWidth = await hostPage
      .locator('.room-mosaic__tile')
      .first()
      .evaluate((node) => node.getBoundingClientRect().width)
    expect(tileWidth).toBeGreaterThanOrEqual(240)

    // The canvas scrolls, and the header and shelf stay inside the viewport.
    const canvas = hostPage.locator('.room-stage__canvas')
    await canvas.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    const afterCanvasScroll = await hostPage.evaluate(() => {
      const box = (selector: string) => {
        const node = document.querySelector(selector)
        if (!node) throw new Error(`${selector} is missing`)
        return node.getBoundingClientRect()
      }
      const header = box('.room-header')
      const shelf = box('.room-shelf')
      const canvasNode = document.querySelector('.room-stage__canvas')
      if (!canvasNode) throw new Error('.room-stage__canvas is missing')
      return {
        canvasScrollTop: canvasNode.scrollTop,
        documentScrollTop: document.documentElement.scrollTop,
        headerInside: header.top >= -1 && header.bottom <= window.innerHeight + 1,
        shelfInside: shelf.top >= -1 && shelf.bottom <= window.innerHeight + 1,
      }
    })
    expect(afterCanvasScroll.canvasScrollTop).toBeGreaterThan(0)
    expect(afterCanvasScroll.documentScrollTop).toBe(0)
    expect(afterCanvasScroll.headerInside).toBe(true)
    expect(afterCanvasScroll.shelfInside).toBe(true)

    // The dock panel scrolls on its own, and it is a shelf, not a sticky block.
    const dockPanel = hostPage.locator('.room-dock__panel')
    await dockPanel.evaluate((node) => {
      node.scrollTop = 120
    })
    const afterDockScroll = await hostPage.evaluate(() => {
      const panel = document.querySelector('.room-dock__panel')
      const canvasNode = document.querySelector('.room-stage__canvas')
      const dock = document.querySelector('.room-dock')
      if (!panel || !canvasNode || !dock) throw new Error('dock layout is missing')
      return {
        panelScrollTop: panel.scrollTop,
        canvasScrollTop: canvasNode.scrollTop,
        documentScrollTop: document.documentElement.scrollTop,
        dockPosition: getComputedStyle(dock).position,
      }
    })
    expect(afterDockScroll.panelScrollTop).toBeGreaterThan(0)
    expect(afterDockScroll.canvasScrollTop).toBe(afterCanvasScroll.canvasScrollTop)
    expect(afterDockScroll.documentScrollTop).toBe(0)
    expect(afterDockScroll.dockPosition).not.toBe('sticky')

    // A phone keeps the ordinary document scroll instead.
    await hostPage.setViewportSize({ width: 390, height: 844 })
    await expect(hostPage.locator('.room-shell')).toHaveCSS('overflow-y', 'visible')
    await expect
      .poll(() =>
        hostPage.evaluate(
          () =>
            document.documentElement.scrollHeight -
            document.documentElement.clientHeight,
        ),
      )
      .toBeGreaterThan(1)
  } finally {
    await dropRoom(authSessions, roomId)
  }
})

test('a pre-admission room keeps its whole boundary reachable on a desktop', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const hostPage = await host.context.newPage()
  const roomId = await createAdmittedRoom(hostPage, 'Reachable boundary room')
  try {
    const visitor = await authSessions.createBrowserContext(VISITOR_PROFILE)
    const visitorPage = await visitor.context.newPage()
    await visitorPage.setViewportSize({ width: 1280, height: 520 })
    await visitorPage.goto(`/rooms/${roomId}`)
    await expect(
      visitorPage.locator('[data-room-state="pre-admission"]'),
    ).toBeVisible()

    // WCAG 1.4.4: text at 200% keeps the desktop width and doubles the copy's
    // height. Only the admitted room owns the viewport (ADR 0100) — this state
    // has no inner scroller, so clamping the shell here would put whatever no
    // longer fits out of reach.
    await visitorPage.evaluate(() => {
      document.documentElement.style.fontSize = '32px'
    })
    const reach = await visitorPage.evaluate(() => {
      const boundary = document.querySelector('.room-boundary')
      if (!boundary) throw new Error('The pre-admission boundary is missing')
      const scroller = document.scrollingElement as HTMLElement
      scroller.scrollTop = scroller.scrollHeight
      return {
        boundaryHidden: boundary.scrollHeight - boundary.clientHeight,
        documentOverflow: scroller.scrollHeight - scroller.clientHeight,
        boundaryBottom: boundary.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
      }
    })
    // Nothing clipped inside the boundary, and the document scrolls what does
    // not fit into view — the boundary ends inside the viewport once it has.
    expect(reach.boundaryHidden).toBeLessThanOrEqual(1)
    expect(reach.documentOverflow).toBeGreaterThan(1)
    expect(reach.boundaryBottom).toBeLessThanOrEqual(reach.viewportHeight + 1)
  } finally {
    await dropRoom(authSessions, roomId)
  }
})
