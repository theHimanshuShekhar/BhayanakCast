import { randomUUID } from 'node:crypto'
import { expect, test } from './fixtures'

const VIEWER = {
  id: '842198421984219842',
  username: 'room-route-viewer',
  global_name: 'Route Viewer',
  avatar: 'room-route-viewer-avatar',
  email: 'room-route-viewer@example.test',
  verified: true,
}

test('anonymous and signed-in visitors get canonical responsive pre-admission gates', async ({
  authSessions,
  browser,
}) => {
  const ownerId = randomUUID()
  const publicRoomId = randomUUID()
  const privateRoomId = randomUUID()
  const fullRoomId = randomUUID()
  const fillerIds = Array.from({ length: 9 }, () => randomUUID())

  await authSessions.sql(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Hidden Host Identity', $2, false, now(), now())`,
    [ownerId, `${ownerId}@example.test`],
  )
  for (const [roomId, name, visibility, description] of [
    [publicRoomId, 'Public route room', 'public', null],
    [privateRoomId, 'Private route room', 'private', 'Bring your favorite creature feature.'],
    [fullRoomId, 'Full route room', 'public', null],
  ] as const) {
    await authSessions.sql(
      `INSERT INTO room (
         id, name, category, description, tags, visibility, password_hash, created_by, created_at
       ) VALUES ($1, $2, 'Horror', $3, ARRAY['late-night', 'friends'], $4, $5, $6, now())`,
      [roomId, name, description, visibility, visibility === 'private' ? 'opaque-test-hash' : null, ownerId],
    )
    await authSessions.sql(
      `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
       VALUES ($1, $2, $3, 'host', now(), CASE WHEN $2::uuid = $4::uuid THEN NULL ELSE now() END)`,
      [randomUUID(), roomId, ownerId, fullRoomId],
    )
  }
  for (const fillerId of fillerIds) {
    await authSessions.sql(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ($1, 'Hidden full-room member', $2, false, now(), now())`,
      [fillerId, `${fillerId}@example.test`],
    )
    await authSessions.sql(
      `INSERT INTO room_membership (id, room_id, account_id, role, joined_at)
       VALUES ($1, $2, $3, 'member', now())`,
      [randomUUID(), fullRoomId, fillerId],
    )
  }

  const anonymous = await browser.newContext({ baseURL: authSessions.origin })
  const signedIn = await authSessions.createBrowserContext(VIEWER)
  try {
    const anonymousPage = await anonymous.newPage()
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1280, height: 800 },
    ]) {
      await anonymousPage.setViewportSize(viewport)
      await anonymousPage.goto(`/rooms/${publicRoomId}`)
      await expect(anonymousPage.locator('[data-room-state="pre-admission"]')).toBeVisible()
      await expect(anonymousPage.getByText('Public Room', { exact: true })).toBeVisible()
      await expect(anonymousPage.getByText('Live', { exact: true })).toBeVisible()
      await expect(anonymousPage.getByRole('button', { name: 'Join', exact: true })).toBeEnabled()
      await expect(anonymousPage.locator('.room-header__description')).toHaveCount(0)
      await expect(anonymousPage.getByText('Hidden Host Identity')).toHaveCount(0)
      await expect(anonymousPage.locator('.room-dock, .room-mosaic, [aria-label="Chat"]')).toHaveCount(0)

      const spotlight = await anonymousPage.locator('.room-spotlight').boundingBox()
      const seats = await anonymousPage.getByTestId('room-seats').boundingBox()
      expect(spotlight).not.toBeNull()
      expect(seats).not.toBeNull()
      if (!spotlight || !seats) throw new Error('Expected responsive gate regions')
      if (viewport.width >= 1280) expect(seats.x).toBeGreaterThan(spotlight.x + spotlight.width)
      else expect(seats.y).toBeGreaterThan(spotlight.y + spotlight.height)
    }

    const signedInPage = await signedIn.context.newPage()
    await signedInPage.setViewportSize({ width: 1280, height: 800 })
    await signedInPage.goto(`/rooms/${privateRoomId}`)
    await expect(signedInPage.getByText('Private Room', { exact: true })).toBeVisible()
    await expect(signedInPage.getByText('Bring your favorite creature feature.')).toBeVisible()
    await expect(signedInPage.getByText('#late-night', { exact: true })).toBeVisible()
    await expect(signedInPage.getByText('#friends', { exact: true })).toBeVisible()
    const password = signedInPage.getByLabel('Password (at least 8 characters)')
    const join = signedInPage.getByRole('button', { name: 'Join', exact: true })
    await expect(password).toBeVisible()
    await expect(join).toBeDisabled()
    await password.fill('12345678')
    await expect(join).toBeEnabled()
    await expect(signedInPage.getByText('Hidden Host Identity')).toHaveCount(0)

    await signedInPage.goto(`/rooms/${fullRoomId}`)
    await expect(
      signedInPage.locator('.room-fact--warning').filter({ hasText: /^Full$/ }),
    ).toHaveText('Full')
    await expect(signedInPage.getByText('10 of 10 here', { exact: true })).toBeVisible()
    await expect(signedInPage.getByRole('button', { name: 'Full', exact: true })).toBeDisabled()
    await expect(signedInPage.getByLabel(/Password/)).toHaveCount(0)
  } finally {
    await anonymous.close()
    await authSessions.sql(
      'DELETE FROM room_membership WHERE room_id = ANY($1::uuid[])',
      [[publicRoomId, privateRoomId, fullRoomId]],
    )
    await authSessions.sql(
      'DELETE FROM room WHERE id = ANY($1::uuid[])',
      [[publicRoomId, privateRoomId, fullRoomId]],
    )
    for (const fillerId of fillerIds) {
      await authSessions.sql('DELETE FROM "user" WHERE id = $1', [fillerId])
    }
    await authSessions.sql('DELETE FROM "user" WHERE id = $1', [ownerId])
  }
})

test('Past Stream keeps bounded metadata and end facts without active-room affordances', async ({
  authSessions,
  browser,
}, testInfo) => {
  const ownerId = randomUUID()
  const roomId = randomUUID()
  const membershipId = randomUUID()
  await authSessions.sql(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Past owner', $2, false, now(), now())`,
    [ownerId, `${ownerId}@example.test`],
  )
  await authSessions.sql(
    `INSERT INTO room (
       id, name, category, description, tags, visibility, password_hash, created_by, created_at, ended_at
     ) VALUES (
       $1, 'Ended metadata room', 'Movies', 'A completed creature double feature.',
       ARRAY['archive', 'horror'], 'private', 'opaque-test-hash', $2, now() - interval '2 hours', now()
     )`,
    [roomId, ownerId],
  )
  await authSessions.sql(
    `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
     VALUES ($1, $2, $3, 'host', now() - interval '2 hours', now())`,
    [membershipId, roomId, ownerId],
  )
  await authSessions.sql(
    `INSERT INTO stream (id, room_id, membership_id, started_at, ended_at)
     VALUES ($1, $2, $3, now() - interval '90 minutes', now() - interval '30 minutes')`,
    [randomUUID(), roomId, membershipId],
  )

  const context = await browser.newContext({ baseURL: authSessions.origin })
  try {
    const page = await context.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const previewRequests: string[] = []
    await page.route('**/api/past-stream-previews/**', (route) => {
      previewRequests.push(route.request().url())
      return route.abort()
    })
    await page.goto(`/rooms/${roomId}`)
    await expect(page.getByText('Past Stream', { exact: true })).toBeVisible()
    await expect(page.getByText('Private', { exact: true })).toBeVisible()
    await expect(page.getByText('A completed creature double feature.')).toBeVisible()
    await expect(page.getByText('1 member', { exact: true })).toBeVisible()
    await expect(page.getByText('1 screen shared', { exact: true })).toBeVisible()
    await expect(page.getByText('No replay or public transcript is available.')).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.getByRole('button', { name: /Join|Replay|Transcript/i })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Join|Replay|Transcript/i })).toHaveCount(0)
    const placeholder = page.locator('.past-stream-item__media--private')
    await expect(placeholder).toHaveCount(1)
    await expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('.room-stage img, .room-stage video')).toHaveCount(0)
    expect(previewRequests).toEqual([])
    const placeholderBox = await placeholder.boundingBox()
    expect(placeholderBox).not.toBeNull()
    expect(placeholderBox!.width / placeholderBox!.height).toBeGreaterThan(1.7)
    expect(placeholderBox!.width / placeholderBox!.height).toBeLessThan(1.85)
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('private-past-stream-summary-mobile.png'),
    })
  } finally {
    await context.close()
    await authSessions.sql('DELETE FROM stream WHERE room_id = $1', [roomId])
    await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
    await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
    await authSessions.sql('DELETE FROM "user" WHERE id = $1', [ownerId])
  }
})

test('Past Stream summary shows public captures and collapses missing media', async ({
  authSessions,
  browser,
}, testInfo) => {
  const ownerId = randomUUID()
  const publicRoomId = randomUUID()
  const noCaptureRoomId = randomUUID()
  const publicMembershipId = randomUUID()
  const noCaptureMembershipId = randomUUID()
  const publicStreamId = randomUUID()
  await authSessions.sql(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Past media owner', $2, false, now(), now())`,
    [ownerId, `${ownerId}@example.test`],
  )
  await authSessions.sql(
    `INSERT INTO room
       (id, name, tags, visibility, created_by, created_at, ended_at)
     VALUES
       ($1, 'Public capture summary', ARRAY[]::text[], 'public', $3,
        now() - interval '2 hours', now()),
       ($2, 'No capture summary', ARRAY[]::text[], 'public', $3,
        now() - interval '2 hours', now())`,
    [publicRoomId, noCaptureRoomId, ownerId],
  )
  await authSessions.sql(
    `INSERT INTO room_membership
       (id, room_id, account_id, role, joined_at, left_at)
     VALUES
       ($1, $3, $5, 'host', now() - interval '2 hours', now()),
       ($2, $4, $5, 'host', now() - interval '2 hours', now())`,
    [
      publicMembershipId,
      noCaptureMembershipId,
      publicRoomId,
      noCaptureRoomId,
      ownerId,
    ],
  )
  await authSessions.sql(
    `INSERT INTO stream
       (id, room_id, membership_id, started_at, ended_at)
     VALUES
       ($1, $3, $5, now() - interval '90 minutes', now()),
       ($2, $4, $6, now() - interval '90 minutes', now())`,
    [
      publicStreamId,
      randomUUID(),
      publicRoomId,
      noCaptureRoomId,
      publicMembershipId,
      noCaptureMembershipId,
    ],
  )
  await authSessions.sql(
    `INSERT INTO past_stream_thumbnail
       (room_id, stream_id, bytes, captured_at)
     VALUES ($1, $2, decode('00', 'hex'), now() - interval '1 minute')`,
    [publicRoomId, publicStreamId],
  )

  const context = await browser.newContext({ baseURL: authSessions.origin })
  try {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1024, height: 900 })
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
    await page.goto(`/rooms/${publicRoomId}`)
    const image = page.locator('.room-stage img')
    await expect(image).toHaveCount(1)
    await expect(image).toHaveAttribute(
      'src',
      new RegExp(`/api/past-stream-previews/${publicRoomId}\\?capturedAt=`),
    )
    await image.scrollIntoViewIfNeeded()
    await expect.poll(() => previewRequests.length).toBe(1)
    await expect(page.getByRole('button', { name: /Join|Replay/i })).toHaveCount(0)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    const imageBox = await image.boundingBox()
    expect(imageBox).not.toBeNull()
    expect(imageBox!.width / imageBox!.height).toBeGreaterThan(1.7)
    expect(imageBox!.width / imageBox!.height).toBeLessThan(1.85)
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('public-past-stream-summary-desktop.png'),
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('public-past-stream-summary-mobile.png'),
    })

    await page.goto(`/rooms/${noCaptureRoomId}`)
    await expect(page.locator('.past-stream-item__media')).toHaveCount(0)
    await expect(page.getByText('This room has ended.')).toBeVisible()
  } finally {
    await context.close()
    await authSessions.sql(
      'DELETE FROM past_stream_thumbnail WHERE room_id = $1',
      [publicRoomId],
    )
    await authSessions.sql(
      'DELETE FROM stream WHERE room_id = ANY($1::uuid[])',
      [[publicRoomId, noCaptureRoomId]],
    )
    await authSessions.sql(
      'DELETE FROM room_membership WHERE room_id = ANY($1::uuid[])',
      [[publicRoomId, noCaptureRoomId]],
    )
    await authSessions.sql(
      'DELETE FROM room WHERE id = ANY($1::uuid[])',
      [[publicRoomId, noCaptureRoomId]],
    )
    await authSessions.sql('DELETE FROM "user" WHERE id = $1', [ownerId])
  }
})
