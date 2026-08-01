import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

const ADMIN = { id: '102938475610293900', username: 'room-admin', global_name: 'Room Admin', avatar: 'admin-avatar', email: 'room-admin@example.test', verified: true }
const HOST = { id: '302938475610293902', username: 'room-host', global_name: 'Room Host', avatar: 'host-avatar', email: 'room-host@example.test', verified: true }
const MEMBER = { id: '402938475610293903', username: 'room-member', global_name: 'Room Member', avatar: 'member-avatar', email: 'room-member@example.test', verified: true }

async function sessionId(page: Page) {
  const value: unknown = await (await page.request.get('/api/session')).json()
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') {
    throw new TypeError('Expected session')
  }
  return value.id
}

test('Admin ends a populated Room and every connected Account reaches the generic Past Stream at its stable URL', async ({ authSessions }) => {
  const admin = await authSessions.createBrowserContext(ADMIN)
  const host = await authSessions.createBrowserContext(HOST)
  const member = await authSessions.createBrowserContext(MEMBER)
  const adminPage = await admin.context.newPage()
  const hostPage = await host.context.newPage()
  const memberPage = await member.context.newPage()
  const [hostId, memberId] = await Promise.all([sessionId(hostPage), sessionId(memberPage)])

  const roomId = randomUUID()
  const hostMembershipId = randomUUID()
  const memberMembershipId = randomUUID()
  const hostStreamId = randomUUID()
  const memberStreamId = randomUUID()
  await authSessions.sql(
    `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_at, ended_at)
     VALUES ($1, 'Admin intervention fixture', NULL, ARRAY[]::text[], 'public', NULL, now(), NULL)`,
    [roomId],
  )
  await authSessions.sql(
    `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
     VALUES ($1, $3, $4, 'host', now(), NULL), ($2, $3, $5, 'member', now(), NULL)`,
    [hostMembershipId, memberMembershipId, roomId, hostId, memberId],
  )
  await authSessions.sql(
    `INSERT INTO stream (id, room_id, membership_id, started_at, ended_at)
     VALUES ($1, $3, $4, now(), NULL), ($2, $3, $5, now(), NULL)`,
    [hostStreamId, memberStreamId, roomId, hostMembershipId, memberMembershipId],
  )
  await authSessions.sql(
    `INSERT INTO stream_subscription (id, stream_id, viewer_membership_id, started_at, ended_at)
     VALUES ($1, $3, $5, now(), NULL), ($2, $4, $6, now(), NULL)`,
    [randomUUID(), randomUUID(), hostStreamId, memberStreamId, memberMembershipId, hostMembershipId],
  )

  await Promise.all([hostPage.goto(`/rooms/${roomId}`), memberPage.goto(`/rooms/${roomId}`)])
  await expect(hostPage.getByRole('button', { name: 'End Room' })).toHaveCount(0)
  await hostPage.goto('/admin')
  await expect(hostPage.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await hostPage.goto(`/rooms/${roomId}`)

  await adminPage.goto('/admin')
  const roomItem = adminPage.locator('.admin-room-item').filter({ hasText: 'Admin intervention fixture' })
  await roomItem.getByRole('button', { name: 'End Room' }).click()
  const confirm = roomItem.getByRole('button', { name: 'Confirm end Room' })
  await confirm.focus()
  await expect(confirm).toBeFocused()
  await confirm.click()

  await Promise.all([
    expect(hostPage).toHaveURL(`/rooms/${roomId}`),
    expect(memberPage).toHaveURL(`/rooms/${roomId}`),
    expect(hostPage.getByText('This room has ended.')).toBeVisible(),
    expect(memberPage.getByText('This room has ended.')).toBeVisible(),
  ])
  await expect(hostPage.getByText(/ended by|moderation reason|enforcement action|sanction/i)).toHaveCount(0)
  await expect(memberPage.getByText(/ended by|moderation reason|enforcement action|sanction/i)).toHaveCount(0)
  await expect(hostPage.getByRole('button', { name: 'Join' })).toHaveCount(0)
  await expect(memberPage.getByRole('button', { name: 'Join' })).toHaveCount(0)
})
