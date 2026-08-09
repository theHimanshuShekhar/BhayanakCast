import { randomUUID } from 'node:crypto'
import type { Page, TestInfo } from '@playwright/test'
import { expect, test } from './fixtures'
import type { AuthSessionFixture } from './fixtures'

const roomIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
] as const

interface SeededDiscovery {
  readonly privateAccountId: string
}

async function addRoom(
  authSessions: AuthSessionFixture,
  input: {
    readonly id: string
    readonly name: string
    readonly visibility: 'public' | 'private'
    readonly memberCount: number
    readonly previewCount: number
    readonly category?: string | null
    readonly tags?: readonly string[]
    readonly endedAt?: string
  },
): Promise<{ readonly accountIds: readonly string[]; readonly membershipIds: readonly string[] }> {
  await authSessions.sql(
    `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_at, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz - interval '1 hour', now() - interval '1 hour'), $7)`,
    [
      input.id,
      input.name,
      input.category === undefined ? 'Games' : input.category,
      input.tags ?? ['cozy', 'community'],
      input.visibility,
      input.visibility === 'private' ? 'test-password-hash' : null,
      input.endedAt ?? null,
    ],
  )

  const accountIds: string[] = []
  const membershipIds: string[] = []
  for (let index = 0; index < input.memberCount; index += 1) {
    const accountId = randomUUID()
    const membershipId = randomUUID()
    accountIds.push(accountId)
    membershipIds.push(membershipId)
    await authSessions.sql(
      `INSERT INTO "user" (id, name, email, image, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, now(), now())`,
      [
        accountId,
        input.visibility === 'private' ? `Secret member ${index + 1}` : `Public member ${index + 1}`,
        `${accountId}@example.test`,
        `/test-assets/avatar-${input.id.slice(-1)}-${index + 1}.png`,
      ],
    )
    await authSessions.sql(
      `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
       VALUES ($1, $2, $3, 'member', COALESCE($4::timestamptz - interval '30 minutes', now() - interval '30 minutes'), $4)`,
      [membershipId, input.id, accountId, input.endedAt ?? null],
    )
  }

  for (let index = 0; index < input.previewCount; index += 1) {
    await authSessions.sql(
      `INSERT INTO stream (id, room_id, membership_id, preview_key, preview_updated_at, started_at, ended_at)
       VALUES ($1, $2, $3, $4, COALESCE($6::timestamptz - ($5 * interval '1 minute'), now() - ($5 * interval '1 minute')), COALESCE($6::timestamptz - interval '20 minutes', now() - interval '20 minutes'), $6)`,
      [
        randomUUID(),
        input.id,
        membershipIds[index % membershipIds.length],
        `preview-${input.id.slice(-1)}-${index + 1}`,
        index,
        input.endedAt ?? null,
      ],
    )
  }

  return { accountIds, membershipIds }
}

async function seedPastStreams(authSessions: AuthSessionFixture) {
  const publicRoomId = '20000000-0000-4000-8000-000000000001'
  await addRoom(authSessions, {
    id: publicRoomId,
    name: 'Yesterday’s Drawing Table',
    visibility: 'public',
    memberCount: 2,
    previewCount: 1,
    category: 'Art',
    tags: ['drawing'],
    endedAt: '2026-07-15T15:00:00.000Z',
  })
  await authSessions.sql(
    `INSERT INTO past_stream_thumbnail (room_id, stream_id, bytes, captured_at)
     SELECT $1, id, decode('00', 'hex'), $2::timestamp
       FROM stream
      WHERE room_id = $1
      LIMIT 1`,
    [publicRoomId, '2026-07-15T14:59:00.000Z'],
  )
  await addRoom(authSessions, {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'Late Night Study',
    visibility: 'private',
    memberCount: 1,
    previewCount: 0,
    category: null,
    tags: [],
    endedAt: '2026-07-15T14:00:00.000Z',
  })
}

async function seedDiscovery(authSessions: AuthSessionFixture): Promise<SeededDiscovery> {
  const featured = await addRoom(authSessions, {
    id: roomIds[0],
    name: 'Atlas Studio',
    visibility: 'public',
    memberCount: 6,
    previewCount: 5,
    category: 'Art',
    tags: ['drawing', 'friends'],
  })
  const privateRoom = await addRoom(authSessions, {
    id: roomIds[1],
    name: 'Lantern Circle',
    visibility: 'private',
    memberCount: 4,
    previewCount: 1,
    category: 'Talk',
    tags: ['quiet'],
  })
  await addRoom(authSessions, {
    id: roomIds[2],
    name: 'Quiet Table',
    visibility: 'public',
    memberCount: 3,
    previewCount: 0,
    category: 'Study',
    tags: [],
  })
  await addRoom(authSessions, {
    id: roomIds[3],
    name: 'Indie Watch Party',
    visibility: 'public',
    memberCount: 2,
    previewCount: 1,
    category: 'Film',
    tags: ['indie'],
  })
  await seedPastStreams(authSessions)
  expect(featured.accountIds).toHaveLength(6)
  return { privateAccountId: privateRoom.accountIds[0]! }
}

async function interceptImages(page: Page) {
  await page.route('**/api/stream-previews/**', (route) =>
    route.fulfill({
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
      contentType: 'image/png',
    }),
  )
  await page.route('**/test-assets/avatar-*.png', (route) =>
    route.fulfill({
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
      contentType: 'image/png',
    }),
  )
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ fullPage: true, path: testInfo.outputPath(name) })
}

test('renders ranked live rooms with private previews and one canonical link per card', async ({
  authSessions,
  page,
}) => {
  const { privateAccountId } = await seedDiscovery(authSessions)
  await interceptImages(page)
  await page.goto(authSessions.origin)

  const cards = page.locator('.live-room-card')
  await expect(cards).toHaveCount(4)
  await expect(cards.locator('a')).toHaveCount(4)
  await expect(cards.locator('button')).toHaveCount(0)
  expect(await cards.first().getAttribute('data-room-id')).toBe(roomIds[0])
  expect(await cards.locator('[data-room-name]').allTextContents()).toEqual([
    'Atlas Studio',
    'Lantern Circle',
    'Quiet Table',
    'Indie Watch Party',
  ])

  const destinations = await cards.locator('a').evaluateAll((links) =>
    links.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
  )
  expect(destinations).toEqual(roomIds.map((id) => `/rooms/${id}`))
  expect(
    await cards.locator('a').evaluateAll((links) =>
      links.map((link) => link.getAttribute('aria-label')),
    ),
  ).toEqual([
    'Open Atlas Studio room',
    'Open Lantern Circle room',
    'Open Quiet Table room',
    'Open Indie Watch Party room',
  ])

  // ADR 0084: five active Streams show the four freshest previews, and the
  // overflow is carried by the total Stream count rather than a mosaic cell.
  const featuredPreviews = cards.nth(0).locator('.preview-mosaic img')
  await expect(featuredPreviews).toHaveCount(4)
  await expect(featuredPreviews.first()).toHaveCSS('filter', 'none')
  await expect(cards.nth(0).locator('.preview-mosaic__summary')).toHaveText(
    '5 screens shared',
  )
  const privatePreview = cards.nth(1).locator('.preview-mosaic img')
  await expect(privatePreview).toHaveCount(1)
  expect(await privatePreview.evaluate((image) => getComputedStyle(image).filter)).toContain('blur')
  expect(await privatePreview.getAttribute('alt')).toBe('')

  await expect(cards.nth(2).locator('img')).toHaveCount(3)
  await expect(cards.nth(2).getByText('Talking, no screens up')).toBeVisible()
  await expect(page.locator('[data-placeholder]')).toHaveCount(0)
  expect(await page.locator('body').innerHTML()).not.toContain(privateAccountId)
  await expect(page.getByText('Secret member 1')).toHaveCount(0)
})

test('places the frozen feature responsively while preserving DOM rank order', async ({
  authSessions,
  page,
}, testInfo) => {
  await seedDiscovery(authSessions)
  await interceptImages(page)
  await page.goto(authSessions.origin)

  const cards = page.locator('.live-room-card')
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const boxes = await cards.evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect()
        return { height: box.height, width: box.width, x: box.x, y: box.y }
      }),
    )
    expect(await cards.locator('[data-room-name]').allTextContents()).toEqual([
      'Atlas Studio',
      'Lantern Circle',
      'Quiet Table',
      'Indie Watch Party',
    ])

    if (width === 1440) {
      // Busiest room takes a full-width row; Also live is a three-up grid below it.
      expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y)
      expect(boxes[0]!.width).toBeGreaterThan(boxes[1]!.width * 1.5)
      expect(new Set(boxes.slice(1).map(({ y }) => Math.round(y))).size).toBe(1)
      expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x)
      expect(boxes[2]!.x).toBeLessThan(boxes[3]!.x)
    } else if (width === 1024) {
      // Also live drops to two-up, so the fourth card wraps under the second.
      expect(boxes[0]!.width).toBeGreaterThan(boxes[1]!.width * 1.5)
      expect(Math.round(boxes[1]!.y)).toBe(Math.round(boxes[2]!.y))
      expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x)
      expect(Math.round(boxes[3]!.x)).toBe(Math.round(boxes[1]!.x))
      expect(boxes[3]!.y).toBeGreaterThan(boxes[1]!.y)
      const preview = await cards.first().locator('.preview-mosaic').boundingBox()
      expect(preview).not.toBeNull()
      expect(preview!.width / preview!.height).toBeGreaterThan(1.7)
      expect(preview!.width / preview!.height).toBeLessThan(1.85)
    } else {
      expect(new Set(boxes.map(({ x }) => Math.round(x))).size).toBe(1)
      expect(boxes.map(({ y }) => y)).toEqual([...boxes.map(({ y }) => y)].sort((a, b) => a - b))
    }
    await screenshot(page, testInfo, `normal-${width}.png`)
  }
})

test('renders public Past Stream thumbnails inside the unchanged card link', async ({
  authSessions,
  page,
}, testInfo) => {
  const previewRequests: string[] = []
  await page.route('**/api/past-stream-previews/**', (route) => {
    previewRequests.push(route.request().url())
    return route.fulfill({
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
      contentType: 'image/png',
      status: 200,
    })
  })
  await seedDiscovery(authSessions)
  await page.goto(authSessions.origin)

  const items = page.locator('.past-stream-item')
  await expect(items).toHaveCount(2)
  expect(await items.locator('[data-past-stream-name]').allTextContents()).toEqual([
    'Yesterday’s Drawing Table',
    'Late Night Study',
  ])
  await expect(items.locator('a')).toHaveCount(2)
  const publicLink = items.first().getByRole('link')
  await expect(publicLink).toHaveAccessibleName(
    'Open summary for Yesterday’s Drawing Table',
  )
  const image = publicLink.locator('img')
  await expect(image).toHaveCount(1)
  await expect(image).toHaveAttribute('alt', '')
  await expect(image).toHaveAttribute('loading', 'lazy')
  await expect(image).toHaveAttribute('decoding', 'async')
  await expect(image).toHaveAttribute(
    'src',
    /\/api\/past-stream-previews\/20000000-0000-4000-8000-000000000001\?capturedAt=/,
  )
  await expect(items.nth(1).locator('img, video')).toHaveCount(0)
  await image.scrollIntoViewIfNeeded()
  await expect.poll(() => previewRequests.length).toBe(1)
  expect(previewRequests[0]).toContain('capturedAt=')
  await expect(page.getByText(/replay|carousel|pagination/i)).toHaveCount(0)
  await expect(items.first()).toContainText('2 members')
  await expect(items.first()).toContainText('1 screen')
  await expect(items.first().locator('.past-stream-item__private')).toHaveCount(0)
  await expect(publicLink).toHaveAttribute(
    'href',
    '/rooms/20000000-0000-4000-8000-000000000001',
  )

  await page.setViewportSize({ width: 1024, height: 900 })
  const desktop = await items.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().x))
  expect(Math.round(desktop[0]!)).not.toBe(Math.round(desktop[1]!))
  const desktopBoxes = await items.evaluateAll((rows) =>
    rows.map((row) => row.getBoundingClientRect()),
  )
  expect(Math.round(desktopBoxes[0]!.height)).toBe(
    Math.round(desktopBoxes[1]!.height),
  )
  const imageBox = await image.boundingBox()
  expect(imageBox).not.toBeNull()
  expect(imageBox!.width / imageBox!.height).toBeGreaterThan(1.7)
  expect(imageBox!.width / imageBox!.height).toBeLessThan(1.85)
  await screenshot(page, testInfo, 'past-stream-thumbnail-desktop.png')
  await page.setViewportSize({ width: 390, height: 900 })
  const mobile = await items.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().x))
  expect(Math.round(mobile[0]!)).toBe(Math.round(mobile[1]!))
  await screenshot(page, testInfo, 'past-stream-thumbnail-mobile.png')
})

test('leads empty discovery with one Create Room invitation', async ({
  authSessions,
  page,
}, testInfo) => {
  await page.goto(authSessions.origin)

  const liveSection = page.getByRole('region', { name: 'Live Rooms' })
  await expect(liveSection).toContainText('Nobody has a room open.')
  await expect(liveSection).toContainText('Public rooms')
  await expect(liveSection).toContainText(/private rooms/i)
  await expect(liveSection.getByRole('button', { name: 'Sign in to open a room' })).toBeVisible()
  await expect(liveSection.locator('.empty-discovery__illustration')).toHaveCount(0)
  // The first-timer cue says what the counter above it cannot: nothing has ever
  // run here, rather than restating the count of rooms open right now.
  await expect(liveSection).toContainText('Nothing has been streamed here yet.')
  await expect(page.getByRole('heading', { name: 'Wrapped up' })).toHaveCount(0)
  await expect(page.getByText('No past streams yet.')).toHaveCount(0)

  const order = await page.locator('[data-home-center-region]').evaluateAll((regions) =>
    regions.map((region) => region.getAttribute('data-home-center-region')),
  )
  expect(order).toEqual(['search', 'live-rooms'])

  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await screenshot(page, testInfo, `empty-${width}.png`)
  }
})
