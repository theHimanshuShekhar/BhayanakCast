import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
// The project fixture provisions a migrated per-worker schema and its own
// server, so these cases do not depend on whoever migrated the default schema
// first the way the bare Playwright fixture does.
import { expect, test, gotoHydrated } from './fixtures'
import type { AuthSessionFixture } from './fixtures'
import { installWebRtcProbe } from '../helpers/webrtc'

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
  await gotoHydrated(page, '/')
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
  await authSessions.sql(
    `DELETE FROM stream_subscription
      WHERE stream_id IN (SELECT id FROM stream WHERE room_id = $1)`,
    [roomId],
  )
  await authSessions.sql('DELETE FROM stream WHERE room_id = $1', [roomId])
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

test('a signed-in viewer sees their own rail on a nonexistent room', async ({
  authSessions,
}) => {
  const visitor = await authSessions.createBrowserContext(VISITOR_PROFILE)
  const visitorPage = await visitor.context.newPage()
  await visitorPage.goto(`/rooms/${randomUUID()}`)
  await expect(
    visitorPage.getByRole('button', { name: 'Shell Visitor account' }),
  ).toBeVisible()
  await expect(visitorPage.getByRole('button', { name: DISCORD_DOOR })).toHaveCount(0)
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
    // ADR 0103 (amended): mobile cannot create a Stream, so the bar carries
    // only the four controls it can actually run.
    await expect(roomBar.getByRole('button', { name: 'Stream', exact: true })).toHaveCount(0)
    await expect(roomBar.getByRole('button')).toHaveCount(4)
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
      const header = box('.room-live-header')
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

test('wide companions keep a 360px collapsible dock and preserve room-session state', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const page = await host.context.newPage()
  const roomId = await createAdmittedRoom(page, 'Persistent companions room')
  try {
    await fillRoom(authSessions, roomId)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.reload()
    await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
    await expect(page.getByText('Bounded scroll needs something to scroll, line 60.')).toBeAttached()

    const dock = page.locator('.room-dock')
    await expect(dock).toHaveCSS('width', '360px')
    await expect(dock).toHaveCSS('transition-property', 'transform')
    const tabs = dock.getByRole('tab')
    await expect(tabs).toHaveCount(3)
    await expect(tabs.nth(0)).toHaveAttribute('aria-controls', /.+/)
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    await tabs.nth(0).focus()
    await page.keyboard.press('ArrowRight')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')

    const composer = page.getByLabel('Message')
    await composer.fill('Draft survives companion transitions')
    const panel = dock.getByRole('tabpanel')
    await panel.evaluate((node) => {
      node.scrollTop = Math.floor(node.scrollHeight / 2)
    })
    const chatScroll = await panel.evaluate((node) => node.scrollTop)
    expect(chatScroll).toBeGreaterThan(0)

    await tabs.getByText('People', { exact: true }).click()
    await tabs.getByText('Chat', { exact: true }).click()
    await expect(composer).toHaveValue('Draft survives companion transitions')
    expect(await panel.evaluate((node) => node.scrollTop)).toBe(chatScroll)

    await tabs.getByText('People', { exact: true }).click()
    const firstTile = page.locator('.room-mosaic__tile').first()
    // This DOM marker is a React-remount sentinel: losing it means the tile
    // remounted during dock collapse, which would also drop its active Stream.
    await firstTile.evaluate((node) => node.setAttribute('data-companion-continuity', 'kept'))
    const collapse = dock.getByRole('button', { name: 'Collapse dock' })
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await collapse.click()
    await expect(dock).toHaveCSS('width', '56px')
    const expand = dock.getByRole('button', { name: 'Expand dock' })
    await expect(expand).toBeVisible()
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    await expect(tabs.filter({ hasText: /^People/ })).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(1)).toHaveAttribute('data-tooltip', 'People')
    await expand.click()
    await expect(dock).toHaveCSS('width', '360px')
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await expect(firstTile).toHaveAttribute('data-companion-continuity', 'kept')
  } finally {
    await dropRoom(authSessions, roomId)
  }
})

test('collapsed wide dock hides its composer and preserves activity semantics', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const hostPage = await host.context.newPage()
  const roomId = await createAdmittedRoom(hostPage, 'Collapsed companions room')
  try {
    await hostPage.setViewportSize({ width: 1440, height: 900 })
    const dock = hostPage.locator('.room-dock')
    await dock.getByRole('button', { name: 'Collapse dock' }).click()
    await expect(hostPage.getByLabel('Message')).toBeHidden()
    await expect(dock.getByRole('button', { name: 'Send', exact: true })).toBeHidden()

    const visitor = await authSessions.createBrowserContext(VISITOR_PROFILE)
    const visitorPage = await visitor.context.newPage()
    await visitorPage.goto(`/rooms/${roomId}`)
    await visitorPage.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(visitorPage.locator('[data-room-state="admitted"]')).toBeVisible()

    await dock.getByRole('button', { name: 'Expand dock' }).click()
    await dock.getByRole('tab', { name: /Activity/ }).click()
    await expect(dock.getByText('Shell Visitor joined.')).toBeVisible()
    await expect(dock.locator('.room-activity__time')).toHaveAttribute('datetime', /T/)
  } finally {
    await dropRoom(authSessions, roomId)
  }
})

test('medium companions are a non-modal drawer with Escape focus return and no grid reflow', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const page = await host.context.newPage()
  const roomId = await createAdmittedRoom(page, 'Workspace drawer room')
  try {
    await page.setViewportSize({ width: 1024, height: 768 })
    const dock = page.locator('.room-dock')
    const mosaic = page.locator('.room-mosaic')
    const mosaicBox = () =>
      mosaic.evaluate((node) => {
        const { x, y, width, height } = node.getBoundingClientRect()
        return { x, y, width, height }
      })
    await expect(mosaic).toBeVisible()
    await expect(dock).toHaveCSS('width', '360px')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(async () => (await mosaicBox()).width).toBeGreaterThan(0)
    const before = await mosaicBox()

    await dock.getByRole('tabpanel').focus()
    await page.keyboard.press('Escape')
    await expect(dock).toHaveCSS('width', '56px')
    await expect(dock.getByRole('tab', { name: /Chat/ })).toBeFocused()
    expect(await mosaicBox()).toEqual(before)

    await dock.getByRole('tab', { name: /Chat/ }).click()
    await expect(dock).toHaveCSS('width', '360px')
    await dock.getByRole('button', { name: 'Close' }).click()
    await expect(dock.getByRole('tab', { name: /Chat/ })).toBeFocused()
    expect(await mosaicBox()).toEqual(before)
  } finally {
    await dropRoom(authSessions, roomId)
  }
})

test('mobile companion sheets expose 55% and 90% heights and return focus', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const page = await host.context.newPage()
  const roomId = await createAdmittedRoom(page, 'Mobile companions room')
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    const roomBar = page.getByRole('navigation', { name: 'Room controls' })
    await expect(roomBar.getByRole('button', { name: 'Stream', exact: true })).toHaveCount(0)
    await expect(page.locator('#mobile-stream-guidance')).toHaveCount(0)
    const chatControl = roomBar.getByRole('button', { name: 'Chat' })
    await chatControl.click()
    const dock = page.locator('.room-dock')
    await expect(dock).toHaveAttribute('data-sheet', 'open')
    expect((await dock.boundingBox())?.height).toBeCloseTo(844 * 0.55, 0)

    const composer = page.locator('#room-chat-input')
    const send = dock.getByRole('button', { name: 'Send', exact: true })
    const composerClearance = () =>
      page.evaluate(() => {
        const textarea = document.querySelector<HTMLElement>('#room-chat-input')
        const submit = document.querySelector<HTMLElement>('.room-chat__composer button[type="submit"]')
        const bar = document.querySelector<HTMLElement>('.room-mobile-bar')
        if (!textarea || !submit || !bar) return null
        const barTop = bar.getBoundingClientRect().top
        return {
          textarea: barTop - textarea.getBoundingClientRect().bottom,
          submit: barTop - submit.getBoundingClientRect().bottom,
        }
      })
    await expect.poll(async () => (await composerClearance())?.textarea).toBeGreaterThanOrEqual(0)
    await expect.poll(async () => (await composerClearance())?.submit).toBeGreaterThanOrEqual(0)

    await page.setViewportSize({ width: 320, height: 568 })
    await expect.poll(async () => (await composerClearance())?.textarea).toBeGreaterThanOrEqual(0)
    await expect.poll(async () => (await composerClearance())?.submit).toBeGreaterThanOrEqual(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(dock.getByText('No messages yet')).toBeVisible()
    await expect(dock.getByText('Say hello when you’re ready.')).toBeVisible()
    await expect(dock.getByText('Enter to send · Shift+Enter for a new line')).toBeVisible()

    await composer.focus()
    await expect(dock).toHaveAttribute('data-sheet', 'expanded')
    await expect(page.getByLabel('Message the room')).toBeFocused()
    expect((await dock.boundingBox())?.height).toBeCloseTo(844 * 0.9, 0)
    await expect(send).toBeInViewport()
    await composer.fill('x'.repeat(450))
    const counter = dock.locator('.room-chat__count')
    await expect(counter).toBeVisible()
    const [counterBox, sendBox] = await Promise.all([counter.boundingBox(), send.boundingBox()])
    expect(Math.abs((counterBox?.y ?? 0) + (counterBox?.height ?? 0) - ((sendBox?.y ?? 0) + (sendBox?.height ?? 0)))).toBeLessThan(2)
    await composer.fill('Mobile draft stays here')
    await roomBar.getByRole('button', { name: 'People' }).click()
    await expect(page.locator('.room-dock').getByRole('tab', { name: /People/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator('.room-people__avatar')).toHaveCount(1)
    await chatControl.click()
    await expect(composer).toHaveValue('Mobile draft stays here')

    await page
      .getByRole('button', { name: 'Collapse companion sheet to 55%' })
      .click()
    expect((await dock.boundingBox())?.height).toBeCloseTo(844 * 0.55, 0)
    await page
      .getByRole('button', { name: 'Expand companion sheet to 90%' })
      .click()
    expect((await dock.boundingBox())?.height).toBeCloseTo(844 * 0.9, 0)
    await page
      .getByRole('button', { name: 'Collapse companion sheet to 55%' })
      .click()

    await page.keyboard.press('Escape')
    await expect(chatControl).toBeFocused()
    await roomBar.getByRole('button', { name: 'Activity' }).click()
    await page.locator('.room-dock').getByRole('button', { name: 'Close' }).click()
    await expect(roomBar.getByRole('button', { name: 'Activity' })).toBeFocused()
    await expect(roomBar).toBeVisible()
  } finally {
    await dropRoom(authSessions, roomId)
  }
})

test('the member mosaic exposes responsive emphasis, presence, watcher, media, and failure states', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  await installWebRtcProbe(host.context, 'pass')
  const page = await host.context.newPage()
  const roomId = await createAdmittedRoom(page, 'Adaptive mosaic room')
  try {
    await fillRoom(authSessions, roomId)
    const memberships = (await authSessions.sql(
      `SELECT membership.id, account.name
         FROM room_membership membership
         JOIN "user" account ON account.id = membership.account_id
        WHERE membership.room_id = $1`,
      [roomId],
    )) as { readonly id: string; readonly name: string }[]
    const membership = (name: string) => {
      const found = memberships.find((entry) => entry.name === name)
      if (!found) throw new Error(`Missing ${name}`)
      return found.id
    }
    await authSessions.sql(
      `UPDATE room_membership
          SET reconnect_until = now() + interval '45 seconds'
        WHERE id = $1`,
      [membership('Filler 9')],
    )
    const streamId = randomUUID()
    await authSessions.sql(
      `INSERT INTO stream
         (id, room_id, membership_id, preview_key, preview_updated_at, started_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [streamId, roomId, membership('Filler 1'), `mosaic-${randomUUID()}`],
    )
    for (const [index, name] of ['Filler 2', 'Filler 3', 'Filler 4', 'Filler 5'].entries()) {
      await authSessions.sql(
        `INSERT INTO stream_subscription
           (id, viewer_membership_id, stream_id, started_at)
         VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
        [randomUUID(), membership(name), streamId, index],
      )
    }

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.reload()
    const tiles = page.locator('.room-mosaic__tile')
    await expect(tiles).toHaveCount(10)
    await expect(tiles.first().locator('.room-mosaic__name')).toHaveText('Shell Host')
    await expect(tiles.first().locator('.room-mosaic__state')).toHaveText(
      /Host · You · (Checking media…|Media ready|Chat only)/,
    )
    await expect(
      tiles.filter({ hasText: 'Filler 9' }).locator('.room-mosaic__state'),
    ).toContainText('Reconnecting')
    await expect(
      page.locator(
        '[aria-label="Watched by Filler 2, Filler 3, Filler 4 and 1 more; 4 watchers total"]',
      ),
    ).toBeVisible()
    await expect(page.locator('.room-mosaic__preview')).toHaveCSS('object-fit', 'contain')
    const streamTile = tiles.filter({ hasText: 'Filler 1' })
    const tileSurfaceGaps = await tiles.evaluateAll((nodes) =>
      nodes.map((node) => {
        const tile = node.getBoundingClientRect()
        const footer = node.querySelector<HTMLElement>('.room-mosaic__footer')
        if (!footer) throw new Error('Mosaic tile footer is missing')
        return Math.round(tile.bottom - footer.getBoundingClientRect().bottom)
      }),
    )
    expect(tileSurfaceGaps).toEqual(tileSurfaceGaps.map(() => 0))
    const watchOverlayOffset = await streamTile.evaluate((node) => {
      const presence = node.querySelector<HTMLElement>('.room-mosaic__presence')
      const watch = node.querySelector<HTMLElement>('.room-mosaic__watch')
      if (!presence || !watch) throw new Error('Watch overlay is incomplete')
      const presenceBox = presence.getBoundingClientRect()
      const watchBox = watch.getBoundingClientRect()
      return {
        x: Math.round(watchBox.left + watchBox.width / 2 - (presenceBox.left + presenceBox.width / 2)),
        y: Math.round(watchBox.top + watchBox.height / 2 - (presenceBox.top + presenceBox.height / 2)),
      }
    })
    expect(watchOverlayOffset).toEqual({ x: 0, y: 0 })
    await expect(
      page.locator('.room-mosaic').getByRole('button', { name: 'Actions', exact: true }),
    ).toHaveCount(0)


    // The no-watch phone overview has exactly two columns.
    await page.setViewportSize({ width: 390, height: 844 })
    const overview = await tiles.evaluateAll((nodes) =>
      nodes.slice(0, 4).map((node) => {
        const box = node.getBoundingClientRect()
        return { x: Math.round(box.x), y: Math.round(box.y) }
      }),
    )
    expect(new Set(overview.map(({ x }) => x)).size).toBe(2)
    expect(new Set(overview.map(({ y }) => y)).size).toBe(2)

    // Drive Watch through its real UI transition before measuring either
    // accepted final layout. The probe exhausts the first sequence, then lets
    // Retry deliver media so React owns both watch attributes under assertion.
    await page.setViewportSize({ width: 1024, height: 768 })
    const watch = streamTile.getByRole('button', { name: "Watch Filler 1's screen" })
    await watch.scrollIntoViewIfNeeded()
    await expect(watch).toBeEnabled({ timeout: 30_000 })
    await watch.click()
    await expect(streamTile.getByText('Could not connect to this stream.')).toBeVisible({
      timeout: 12_000,
    })
    await expect
      .poll(async () => {
        const rows = (await authSessions.sql(
          `SELECT count(*)::int AS count
             FROM stream_subscription subscription
            WHERE subscription.viewer_membership_id = $1
              AND subscription.ended_at IS NULL`,
          [membership('Shell Host')],
        )) as { count: number }[]
        return rows[0]?.count ?? 0
      })
      .toBe(0)
    const retry = streamTile.getByRole('button', {
      name: "Retry watching Filler 1's screen",
    })
    await retry.click()
    await expect(streamTile).toHaveAttribute('data-member-watched', 'true')
    await expect(page.locator('.room-mosaic')).toHaveAttribute('data-has-watch', 'true')
    await expect(
      streamTile.getByRole('button', { name: "Stop watching Filler 1's screen" }),
    ).toBeVisible()

    const mediumWatchLayout = await page.locator('.room-mosaic').evaluate((mosaic) => {
      const all = [...mosaic.querySelectorAll<HTMLElement>('.room-mosaic__tile')]
      const watched = mosaic.querySelector<HTMLElement>('[data-member-watched="true"]')
      const canvas = mosaic.closest<HTMLElement>('.room-stage__canvas')
      if (!watched || !canvas) throw new Error('Medium watch layout is incomplete')
      const stage = watched.getBoundingClientRect()
      const viewport = canvas.getBoundingClientRect()
      const others = all
        .filter((tile) => tile !== watched)
        .map((tile) => tile.getBoundingClientRect())
      return {
        stageWidth: Math.round(stage.width),
        mosaicWidth: Math.round(mosaic.clientWidth),
        stageTop: Math.round(stage.top),
        stageBottom: Math.round(stage.bottom),
        canvasBottom: Math.round(viewport.bottom),
        highestOtherTop: Math.round(Math.min(...others.map((box) => box.top))),
        widestOther: Math.round(Math.max(...others.map((box) => box.width))),
        footerRows: Math.round(
          watched.querySelector('.room-mosaic__footer')!.getBoundingClientRect().height,
        ),
        mosaicClientWidth: mosaic.clientWidth,
      }
    })
    // Full mosaic width, first row, every remaining member beneath it.
    expect(mediumWatchLayout.stageWidth).toBe(mediumWatchLayout.mosaicWidth)
    expect(mediumWatchLayout.highestOtherTop).toBeGreaterThan(mediumWatchLayout.stageTop)
    expect(mediumWatchLayout.widestOther).toBeLessThan(mediumWatchLayout.stageWidth)
    await expect
      .poll(() =>
        page.locator('.room-mosaic').evaluate((mosaic) => ({
          scrollWidth: mosaic.scrollWidth,
          clientWidth: mosaic.clientWidth,
        })),
      )
      .toMatchObject({ scrollWidth: mediumWatchLayout.mosaicClientWidth })
    // The stage and its one-row footer fit the canvas, and the next row still
    // peeks: a viewer can see there is another Stream to switch to.
    expect(mediumWatchLayout.stageBottom).toBeLessThanOrEqual(mediumWatchLayout.canvasBottom)
    expect(mediumWatchLayout.canvasBottom - mediumWatchLayout.highestOtherTop).toBeGreaterThan(48)
    expect(mediumWatchLayout.footerRows).toBeLessThan(96)

    await page.setViewportSize({ width: 390, height: 844 })
    const mobile = await page.locator('.room-mosaic').evaluate((mosaic) => {
      const watched = mosaic.querySelector<HTMLElement>('[data-member-watched="true"]')
      const remaining = mosaic.querySelector<HTMLElement>(
        '.room-mosaic__tile:not([data-member-watched="true"])',
      )
      if (!watched || !remaining) throw new Error('Mobile watch layout is incomplete')
      const stage = watched.getBoundingClientRect()
      const strip = remaining.getBoundingClientRect()
      return {
        stageWidth: stage.width,
        stageTop: stage.top,
        stripTop: strip.top,
        scrollWidth: mosaic.scrollWidth,
        clientWidth: mosaic.clientWidth,
      }
    })
    expect(mobile.stageWidth).toBeGreaterThanOrEqual(350)
    expect(mobile.stripTop).toBeGreaterThan(mobile.stageTop)
    expect(mobile.scrollWidth).toBeGreaterThan(mobile.clientWidth)
  } finally {
    await dropRoom(authSessions, roomId)
  }
})

test('a failed compatibility gate can be re-probed without readmission', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  await installWebRtcProbe(host.context, 'fail')
  const page = await host.context.newPage()
  const roomId = await createAdmittedRoom(page, 'Compatibility recovery room')
  try {
    const retry = page.getByRole('button', { name: 'Retry compatibility' })
    await expect(retry).toBeVisible()
    await page.getByRole('tab', { name: /People/ }).click()
    const self = page.locator('.room-people__member', { hasText: 'Shell Host' })
    await expect(self.locator('.room-people__avatar')).toHaveCount(1)
    await expect(self.locator('.room-people__state')).toContainText('Chat only')
    await page.evaluate(() => {
      ;(window as typeof window & { failCompatibilityProbe?: boolean })
        .failCompatibilityProbe = false
    })
    await retry.click()
    await expect(retry).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start Stream' })).toBeEnabled()
    await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
  } finally {
    await dropRoom(authSessions, roomId)
  }
})

test('watch recovery exhausts once, cancels explicitly, and stays stopped after reclaim', async ({
  authSessions,
}) => {
  const host = await authSessions.createBrowserContext(HOST_PROFILE)
  const hostPage = await host.context.newPage()
  const roomId = await createAdmittedRoom(hostPage, 'Watch recovery room')
  const streamId = randomUUID()
  try {
    const memberships = (await authSessions.sql(
      'SELECT id FROM room_membership WHERE room_id = $1 AND role = $2',
      [roomId, 'host'],
    )) as { readonly id: string }[]
    await authSessions.sql(
      'INSERT INTO stream (id, room_id, membership_id, started_at) VALUES ($1, $2, $3, now())',
      [streamId, roomId, memberships[0]!.id],
    )

    await hostPage.reload()
    await expect(hostPage.locator('[data-room-state="admitted"]')).toBeVisible()
    await hostPage.getByRole('tab', { name: /People/ }).click()
    const hostSelf = hostPage.locator('.room-people__member', { hasText: 'Shell Host' })
    // The projection query holds a 5s `staleTime` (room-queries.ts), so a
    // hydration that lands before this seeded Stream is visible cannot refetch
    // until that window expires. The contract is that the Host's own tile stops
    // claiming media once capture is gone, not that it does so inside 5s, so the
    // assertion has to outlast the cache rather than race it.
    await expect(hostSelf.locator('.room-people__state')).toContainText('Screen stopped', {
      timeout: 15_000,
    })
    await expect(hostSelf.locator('.room-people__state')).not.toContainText('Live')

    const viewer = await authSessions.createBrowserContext(VISITOR_PROFILE)
    await installWebRtcProbe(viewer.context, 'pass')
    const page = await viewer.context.newPage()
    await page.goto(`/rooms/${roomId}`)
    await page.getByRole('button', { name: 'Join' }).click()

    await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Watch' })).toBeEnabled()
    await page.getByRole('button', { name: 'Watch' }).click()
    await expect(page.getByText('Connecting… attempt 1 of 4')).toBeVisible()
    await expect(page.getByText('Connecting… attempt 4 of 4')).toBeVisible()
    const retry = page.getByRole('button', { name: 'Retry' })
    await expect(retry).toBeVisible()
    await retry.click()
    await expect(page.getByRole('button', { name: 'Stop watching' })).toBeVisible()
    await page.getByRole('button', { name: 'Stop watching' }).click()
    await expect(page.getByRole('button', { name: 'Watch' })).toBeVisible()

    await viewer.context.setOffline(true)
    await expect(page.getByText(/Reconnecting… 45s remaining/)).toBeVisible()
    await page.getByRole('tab', { name: /People/ }).click()
    const self = page.locator('.room-people__member', { hasText: 'Shell Visitor' })
    await expect(self.locator('.room-people__state')).toContainText('Reconnecting')
    await viewer.context.setOffline(false)
    await expect(page.getByRole('button', { name: 'Watch' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Start Stream' })).toBeEnabled()
    await expect(page.getByText(/Start or Watch again after recovery/)).toHaveCount(0)
  } finally {
    await dropRoom(authSessions, roomId)
  }
})
