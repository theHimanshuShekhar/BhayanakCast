import { randomUUID } from 'node:crypto'
import { expect, test } from './fixtures'
import type { AuthSessionFixture } from './fixtures'

const profileId = '90000000-0000-4000-8000-000000000001'

async function seedPublicProfile(authSessions: AuthSessionFixture) {
  await authSessions.sql(
    `INSERT INTO "user" (id, name, email, image, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, now(), now())`,
    [
      profileId,
      'Profile host',
      'profile-host@example.test',
      '/test-assets/profile-host.png',
    ],
  )

  for (const [index, endedAt] of [
    '2026-07-15T15:00:00.000Z',
    '2026-07-14T15:00:00.000Z',
    '2026-07-13T15:00:00.000Z',
    '2026-07-12T15:00:00.000Z',
  ].entries()) {
    const visibility = index === 1 ? 'private' : 'public'
    const roomId = `91000000-0000-4000-8000-00000000000${index + 1}`
    const membershipId = randomUUID()
    await authSessions.sql(
      `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_at, ended_at)
       VALUES ($1, $2, 'Games', ARRAY['cozy'], $4, $5, $3::timestamptz - interval '1 hour', $3)`,
      [
        roomId,
        `Past stream ${index + 1}`,
        endedAt,
        visibility,
        visibility === 'private' ? 'opaque-test-hash' : null,
      ],
    )
    await authSessions.sql(
      `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
       VALUES ($1, $2, $3, 'member', $4::timestamptz - interval '30 minutes', $4)`,
      [membershipId, roomId, profileId, endedAt],
    )
    const streamId = randomUUID()
    await authSessions.sql(
      `INSERT INTO stream (id, room_id, membership_id, preview_key, preview_updated_at, started_at, ended_at)
       VALUES ($1, $2, $3, NULL, NULL, $4::timestamptz - interval '20 minutes', $4)`,
      [streamId, roomId, membershipId, endedAt],
    )
    if (index === 0) {
      await authSessions.sql(
        `INSERT INTO past_stream_thumbnail
           (room_id, stream_id, bytes, captured_at)
         VALUES ($1, $2, decode('00', 'hex'), $3::timestamptz - interval '1 minute')`,
        [roomId, streamId, endedAt],
      )
    }
  }

  const coUserId = randomUUID()
  await authSessions.sql(
    `INSERT INTO "user" (id, name, email, image, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, now(), now())`,
    [
      coUserId,
      'Profile co-user',
      `${coUserId}@example.test`,
      '/test-assets/profile-co-user.png',
    ],
  )
  await authSessions.sql(
    `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
     VALUES ($1, $2, $3, 'member', '2026-07-15T14:40:00.000Z', '2026-07-15T15:00:00.000Z')`,
    [randomUUID(), '91000000-0000-4000-8000-000000000001', coUserId],
  )
}

test('renders a public profile on direct navigation and reload', async ({
  authSessions,
  page,
}, testInfo) => {
  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  const previewRequests: string[] = []
  await page.route('**/api/past-stream-previews/**', (route) => {
    previewRequests.push(route.request().url())
    return route.fulfill({
      body: imageBytes,
      contentType: 'image/png',
      status: 200,
    })
  })
  await page.route('**/test-assets/profile-*.png', (route) =>
    route.fulfill({
      body: imageBytes,
      contentType: 'image/png',
      status: 200,
    }),
  )
  await seedPublicProfile(authSessions)
  await page.setViewportSize({ width: 1024, height: 900 })

  await page.goto(`${authSessions.origin}/users/${profileId}`)
  await expect(page.getByRole('heading', { name: 'Profile host' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Profile host' })).toBeVisible()
  await expect(page.getByText('4 rooms')).toBeVisible()
  await expect(page.getByText('4 streams')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Wrapped up' })).toBeVisible()
  await expect(page.getByText('Past stream 1')).toBeVisible()
  await expect(page.getByText('Past stream 3')).toBeVisible()
  await expect(page.getByText('Past stream 4')).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Co-user avatar' })).toBeVisible()
  const streams = page.locator('.past-stream-item')
  await expect(streams).toHaveCount(3)
  const publicImage = streams.nth(0).locator('img')
  await expect(publicImage).toHaveCount(1)
  const publicImageSrc = await publicImage.getAttribute('src')
  expect(publicImageSrc).not.toBeNull()
  await publicImage.scrollIntoViewIfNeeded()
  await expect.poll(() => previewRequests.length).toBe(1)
  await expect(streams.nth(1).locator('.past-stream-item__media--private')).toHaveCount(1)
  await expect(streams.nth(1).locator('img, video')).toHaveCount(0)
  await expect(streams.nth(2).locator('.past-stream-item__media')).toHaveCount(0)
  await expect(streams.locator('a')).toHaveCount(3)
  await expect(streams.nth(0).getByRole('link')).toHaveAccessibleName(
    'Open summary for Past stream 1',
  )
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('public-profile-past-streams-desktop.png'),
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('public-profile-past-streams-mobile.png'),
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Profile host' })).toBeVisible()
  const publicLink = page.locator('.past-stream-item').nth(0).getByRole('link')
  await publicLink.click()
  await expect(page).toHaveURL(
    `${authSessions.origin}/rooms/91000000-0000-4000-8000-000000000001`,
  )
  await expect(page.locator('.room-stage img')).toHaveAttribute(
    'src',
    publicImageSrc!,
  )
  expect(
    previewRequests.every((request) =>
      request.includes('91000000-0000-4000-8000-000000000001'),
    ),
  ).toBe(true)
})

test('shows the route not-found boundary for an absent account', async ({
  authSessions,
  page,
}) => {
  await authSessions.sql('SELECT 1')
  await page.goto(`${authSessions.origin}/users/${randomUUID()}`)

  await expect(page.getByRole('heading', { name: 'Profile not found' })).toBeVisible()
})

test('hides deletion-pending accounts behind the route not-found boundary', async ({
  authSessions,
  page,
}) => {
  const accountId = randomUUID()
  await authSessions.sql(
    `INSERT INTO "user" (id, name, email, image, email_verified, created_at, updated_at)
     VALUES ($1, 'Pending deletion', $2, NULL, false, now(), now())`,
    [accountId, `${accountId}@example.test`],
  )
  await authSessions.sql(
    `INSERT INTO account_state (account_id, deletion_requested_at)
     VALUES ($1, now())`,
    [accountId],
  )

  await page.goto(`${authSessions.origin}/users/${accountId}`)

  await expect(page.getByRole('heading', { name: 'Profile not found' })).toBeVisible()
  await expect(page.getByText('Pending deletion')).toHaveCount(0)
})
