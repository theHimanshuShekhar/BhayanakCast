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
}) => {
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
  } finally {
    await context.close()
    await authSessions.sql('DELETE FROM stream WHERE room_id = $1', [roomId])
    await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
    await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
    await authSessions.sql('DELETE FROM "user" WHERE id = $1', [ownerId])
  }
})
