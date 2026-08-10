import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, expectCenteredModal, test, gotoHydrated } from './fixtures'

const PROFILE = {
  id: '102938475610293847',
  username: 'task11-host',
  global_name: 'Task 11 Host',
  avatar: 'task11-host-avatar',
  email: 'task11-host@example.test',
  verified: true,
}

const SECOND_PROFILE = {
  id: '918273645091827364',
  username: 'task11-member',
  global_name: 'Task 11 Member',
  avatar: 'task11-member-avatar',
  email: 'task11-member@example.test',
  verified: true,
}

const TARGET_PROFILE = {
  id: '564738291056473829',
  username: 'task11-target-owner',
  global_name: 'Task 11 Target Owner',
  avatar: 'task11-target-owner-avatar',
  email: 'task11-target-owner@example.test',
  verified: true,
}

async function openCreateRoomDialog(page: Page) {
  const trigger = page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  // The shell can hydrate before its lazy route. Retry only until the click is handled.
  await expect(async () => {
    await trigger.click()
    await expect(dialog).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  return dialog
}
test('create-room validation identifies the field that failed', async ({ authSessions }) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const page = await signedIn.context.newPage()
  await gotoHydrated(page, '/')
  const dialog = await openCreateRoomDialog(page)
  await dialog.getByLabel('Name').fill('Validation room')
  await dialog.getByLabel('Private').check()
  await dialog.getByLabel('Password').fill('short')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Private passwords must be at least 8 characters.')
  await expect(dialog.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByLabel('Password')).toHaveAttribute('aria-describedby', 'create-room-error')

  await dialog.getByLabel('Password').fill('long-enough-password')
  await dialog.getByLabel('Tags').fill('one,two,three,four,five,six')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Use no more than 5 tags.')
  await expect(dialog.getByLabel('Tags')).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByLabel('Tags')).toHaveAttribute('aria-describedby', 'create-room-error')
})


test('creates a room and enters the creator as Host', async ({ authSessions }) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const page = await signedIn.context.newPage()
  await gotoHydrated(page, '/')
  const dialog = await openCreateRoomDialog(page)
  await expect(dialog).toBeVisible()
  await expectCenteredModal(dialog)
  await dialog.getByLabel('Name').fill('Task 11 room')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const roomId = new URL(page.url()).pathname.split('/').at(-1)
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
  await expect(page.locator('.room-live-header__host')).toContainText('Host')
  await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible()
  await page.getByRole('button', { name: 'Leave' }).click()
  const leaveDialog = page.getByRole('dialog', { name: 'Confirm room change' })
  await expectCenteredModal(leaveDialog)
  await leaveDialog.getByRole('button', { name: 'Confirm' }).click()
  await page.waitForURL(/\/$/)
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
})

test('existing Host Create Cancel preserves then Confirm replaces the source room', async ({ authSessions }) => {
  const signedIn = await authSessions.createBrowserContext(PROFILE)
  const page = await signedIn.context.newPage()
  await gotoHydrated(page, '/')
  const initialDialog = await openCreateRoomDialog(page)
  await initialDialog.getByLabel('Name').fill('Existing Host source')
  await initialDialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const sourceRoomId = new URL(page.url()).pathname.split('/').at(-1)
  const accountId = (await authSessions.sql(
    'SELECT id FROM "user" WHERE email = $1',
    [PROFILE.email],
  ) as { id: string }[])[0]?.id
  if (!sourceRoomId || !accountId) throw new Error('Missing seeded source account')

  await gotoHydrated(page, '/')
  const createDialog = await openCreateRoomDialog(page)
  await createDialog.getByLabel('Name').fill('Existing Host replacement')
  await createDialog.getByRole('button', { name: 'Create Room' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Confirm room change' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(createDialog).toBeVisible()
  await expect.poll(async () => {
    const rows = await authSessions.sql(
      'SELECT room_id AS "roomId" FROM room_membership WHERE account_id = $1 AND left_at IS NULL',
      [accountId],
    ) as { roomId: string }[]
    return rows[0]?.roomId
  }).toBe(sourceRoomId)

  await createDialog.getByRole('button', { name: 'Create Room' }).click()
  await page.getByRole('dialog', { name: 'Confirm room change' }).getByRole('button', { name: 'Confirm' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const replacementRoomId = new URL(page.url()).pathname.split('/').at(-1)
  expect(replacementRoomId).not.toBe(sourceRoomId)
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
  await expect.poll(async () => {
    const rows = await authSessions.sql(
      'SELECT room_id AS "roomId", role FROM room_membership WHERE account_id = $1 AND left_at IS NULL',
      [accountId],
    ) as { roomId: string; role: string }[]
    return rows[0]
  }).toEqual({ roomId: replacementRoomId, role: 'host' })
  const sourceMembership = await authSessions.sql(
    `SELECT left_at AS "leftAt"
       FROM room_membership
      WHERE account_id = $1 AND room_id = $2`,
    [accountId, sourceRoomId],
  ) as { leftAt: Date | null }[]
  expect(sourceMembership[0]?.leftAt).not.toBeNull()
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = ANY($1::uuid[])', [[sourceRoomId, replacementRoomId]])
  await authSessions.sql('DELETE FROM room WHERE id = ANY($1::uuid[])', [[sourceRoomId, replacementRoomId]])
})

test('existing Host Stream switch Cancel preserves then Confirm cleans source activity', async ({ authSessions }) => {
  const sourceOwner = await authSessions.createBrowserContext(PROFILE)
  const sourcePage = await sourceOwner.context.newPage()
  await gotoHydrated(sourcePage, '/')
  const sourceDialog = await openCreateRoomDialog(sourcePage)
  await sourceDialog.getByLabel('Name').fill('Active source room')
  await sourceDialog.getByRole('button', { name: 'Create Room' }).click()
  await sourcePage.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const sourceRoomId = new URL(sourcePage.url()).pathname.split('/').at(-1)

  const targetOwner = await authSessions.createBrowserContext(TARGET_PROFILE)
  const targetPage = await targetOwner.context.newPage()
  await gotoHydrated(targetPage, '/')
  const targetDialog = await openCreateRoomDialog(targetPage)
  await targetDialog.getByLabel('Name').fill('Switch target room')
  await targetDialog.getByRole('button', { name: 'Create Room' }).click()
  await targetPage.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const targetRoomId = new URL(targetPage.url()).pathname.split('/').at(-1)

  const sourceAccountId = (await authSessions.sql(
    'SELECT id FROM "user" WHERE email = $1',
    [PROFILE.email],
  ) as { id: string }[])[0]?.id
  const targetAccountId = (await authSessions.sql(
    'SELECT id FROM "user" WHERE email = $1',
    [TARGET_PROFILE.email],
  ) as { id: string }[])[0]?.id
  if (!sourceRoomId || !targetRoomId || !sourceAccountId || !targetAccountId) {
    throw new Error('Missing seeded switch fixture')
  }
  const sourceMembershipId = (await authSessions.sql(
    'SELECT id FROM room_membership WHERE room_id = $1 AND account_id = $2 AND left_at IS NULL',
    [sourceRoomId, sourceAccountId],
  ) as { id: string }[])[0]?.id
  const targetMembershipId = (await authSessions.sql(
    'SELECT id FROM room_membership WHERE room_id = $1 AND account_id = $2 AND left_at IS NULL',
    [targetRoomId, targetAccountId],
  ) as { id: string }[])[0]?.id
  if (!sourceMembershipId || !targetMembershipId) throw new Error('Missing switch memberships')

  // Navigate first, then seed the media. ADR 0103 has an unexpected disconnect
  // close peer media at once, and leaving the source room's page is exactly
  // that disconnect — media seeded before this point would already be stopped
  // by the time the confirmation is computed.
  await gotoHydrated(sourcePage, `${authSessions.origin}/rooms/${targetRoomId}`)
  await expect(sourcePage.getByRole('button', { name: 'Join' })).toBeVisible()
  const sourceStreamId = randomUUID()
  const targetStreamId = randomUUID()
  await authSessions.sql(
    `INSERT INTO stream (id, room_id, membership_id, started_at)
     VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
    [sourceStreamId, sourceRoomId, sourceMembershipId, targetStreamId, targetRoomId, targetMembershipId],
  )
  await authSessions.sql(
    `INSERT INTO stream_subscription (id, viewer_membership_id, stream_id, started_at)
     VALUES ($1, $2, $3, now())`,
    [randomUUID(), sourceMembershipId, targetStreamId],
  )

  await sourcePage.getByRole('button', { name: 'Join' }).click()
  const confirmation = sourcePage.getByRole('dialog', { name: 'Confirm room change' })
  await expect(confirmation).toBeVisible()
  // Proves the server still saw the Stream when it computed the consequences,
  // so a late disconnect cannot make the assertions below pass vacuously.
  await expect(confirmation).toContainText('current Stream will stop')
  const beforeCancel = await authSessions.sql(
    `SELECT
       (SELECT room_id FROM room_membership WHERE id = $1 AND left_at IS NULL) AS "roomId",
       (SELECT ended_at FROM stream WHERE id = $2) AS "streamEndedAt",
       (SELECT ended_at FROM stream_subscription WHERE viewer_membership_id = $1 AND stream_id = $3) AS "subscriptionEndedAt"`,
    [sourceMembershipId, sourceStreamId, targetStreamId],
  ) as { roomId: string; streamEndedAt: Date | null; subscriptionEndedAt: Date | null }[]
  expect(beforeCancel[0]).toEqual({
    roomId: sourceRoomId,
    streamEndedAt: null,
    subscriptionEndedAt: null,
  })
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirmation).toHaveCount(0)
  const afterCancel = await authSessions.sql(
    `SELECT
       (SELECT room_id FROM room_membership WHERE id = $1 AND left_at IS NULL) AS "roomId",
       (SELECT ended_at FROM stream WHERE id = $2) AS "streamEndedAt",
       (SELECT ended_at FROM stream_subscription WHERE viewer_membership_id = $1 AND stream_id = $3) AS "subscriptionEndedAt"`,
    [sourceMembershipId, sourceStreamId, targetStreamId],
  ) as { roomId: string; streamEndedAt: Date | null; subscriptionEndedAt: Date | null }[]
  expect(afterCancel[0]).toEqual(beforeCancel[0])

  await sourcePage.getByRole('button', { name: 'Join' }).click()
  const pendingConfirmation = sourcePage.getByRole('dialog', { name: 'Confirm room change' })
  await expect(pendingConfirmation).toBeVisible()
  const confirmButton = pendingConfirmation.getByRole('button', { name: 'Confirm' })
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await sourcePage.route('**/_serverFn/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await held
    await route.fulfill({ status: 500, body: 'injected room failure' })
  })
  await confirmButton.click()
  await expect(confirmButton).toBeDisabled()
  await sourcePage.keyboard.press('Escape')
  await expect(pendingConfirmation).toBeVisible()
  await pendingConfirmation.evaluate((dialog) => {
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect(pendingConfirmation).toBeVisible()
  release()
  await expect(pendingConfirmation.getByRole('alert')).toContainText('Unable')
  await sourcePage.unroute('**/_serverFn/**')
  await confirmButton.click()
  await expect(sourcePage.locator('[data-room-state="admitted"]')).toBeVisible()
  await expect.poll(async () => {
    const rows = await authSessions.sql(
      'SELECT room_id AS "roomId", role FROM room_membership WHERE account_id = $1 AND left_at IS NULL',
      [sourceAccountId],
    ) as { roomId: string; role: string }[]
    return rows[0]
  }).toEqual({ roomId: targetRoomId, role: 'member' })
  const afterConfirm = await authSessions.sql(
    `SELECT
       (SELECT left_at FROM room_membership WHERE id = $1) AS "sourceLeftAt",
       (SELECT ended_at FROM stream WHERE id = $2) AS "streamEndedAt",
       (SELECT ended_at FROM stream_subscription WHERE viewer_membership_id = $1 AND stream_id = $3) AS "subscriptionEndedAt"`,
    [sourceMembershipId, sourceStreamId, targetStreamId],
  ) as { sourceLeftAt: Date | null; streamEndedAt: Date | null; subscriptionEndedAt: Date | null }[]
  expect(afterConfirm[0]?.sourceLeftAt).not.toBeNull()
  expect(afterConfirm[0]?.streamEndedAt).not.toBeNull()
  expect(afterConfirm[0]?.subscriptionEndedAt).not.toBeNull()
  await authSessions.sql('DELETE FROM stream_subscription WHERE viewer_membership_id = $1', [sourceMembershipId])
  await authSessions.sql('DELETE FROM stream WHERE id = ANY($1::uuid[])', [[sourceStreamId, targetStreamId]])
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = ANY($1::uuid[])', [[sourceRoomId, targetRoomId]])
  await authSessions.sql('DELETE FROM room WHERE id = ANY($1::uuid[])', [[sourceRoomId, targetRoomId]])
})

test('opening a room does not join until the explicit public Join action', async ({ authSessions }) => {
  const owner = await authSessions.createBrowserContext(PROFILE)
  const ownerPage = await owner.context.newPage()
  await gotoHydrated(ownerPage, '/')
  const dialog = await openCreateRoomDialog(ownerPage)
  await dialog.getByLabel('Name').fill('Explicit admission room')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await ownerPage.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const roomUrl = ownerPage.url()
  const roomId = new URL(roomUrl).pathname.split('/').at(-1)
  const member = await authSessions.createBrowserContext(SECOND_PROFILE)
  const page = await member.context.newPage()
  await gotoHydrated(page, '/')
  await page.getByRole('link', { name: 'Open Explicit admission room room' }).click()
  await expect(page.locator('[data-room-state="pre-admission"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Leave' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
  await page.getByRole('button', { name: 'Leave' }).click()
  await page.waitForURL(/\/$/)
  await ownerPage.getByRole('button', { name: 'Leave' }).click()
  await ownerPage.getByRole('dialog', { name: 'Confirm room change' }).getByRole('button', { name: 'Confirm' }).click()
  await ownerPage.waitForURL(/\/$/)
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
})


test('Canceling Leave preserves membership before Confirm applies it', async ({ authSessions }) => {
  const owner = await authSessions.createBrowserContext(PROFILE)
  const page = await owner.context.newPage()
  await gotoHydrated(page, '/')
  const dialog = await openCreateRoomDialog(page)
  await dialog.getByLabel('Name').fill('Confirmation room')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const roomId = new URL(page.url()).pathname.split('/').at(-1)
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
  await page.getByRole('button', { name: 'Leave' }).click()
  const leaveDialog = page.getByRole('dialog', { name: 'Confirm room change' })
  await leaveDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
  await page.getByRole('button', { name: 'Leave' }).click()
  await page.getByRole('dialog', { name: 'Confirm room change' }).getByRole('button', { name: 'Confirm' }).click()
  await page.waitForURL(/\/$/)
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
})

test('signed-in private Join requires the password and admits explicitly', async ({ authSessions }) => {
  const owner = await authSessions.createBrowserContext(PROFILE)
  const ownerPage = await owner.context.newPage()
  await gotoHydrated(ownerPage, '/')
  const dialog = await openCreateRoomDialog(ownerPage)
  await dialog.getByLabel('Name').fill('Private admission room')
  await dialog.getByLabel('Private').check()
  await dialog.getByLabel('Password').fill('private-pass')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await ownerPage.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const roomId = new URL(ownerPage.url()).pathname.split('/').at(-1)
  const member = await authSessions.createBrowserContext(SECOND_PROFILE)
  const memberPage = await member.context.newPage()
  await gotoHydrated(memberPage, ownerPage.url())
  await expect(memberPage.locator('[data-room-state="pre-admission"]')).toBeVisible()
  await expect(memberPage.getByLabel('Password')).toBeVisible()
  await memberPage.getByLabel('Password').fill('private-pass')
  await memberPage.getByRole('button', { name: 'Join' }).click()
  await expect(memberPage.locator('[data-room-state="admitted"]')).toBeVisible()
  await authSessions.sql("DELETE FROM room_membership WHERE room_id = $1 AND role = 'member'", [roomId])
  await ownerPage.getByRole('button', { name: 'Leave' }).click()
  await ownerPage.getByRole('dialog', { name: 'Confirm room change' }).getByRole('button', { name: 'Confirm' }).click()
  await ownerPage.waitForURL(/\/$/)
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [roomId])
  await authSessions.sql('DELETE FROM room WHERE id = $1', [roomId])
})

test('full and ended target rejection preserve active Host Stream source', async ({ authSessions }) => {
  const sourceOwner = await authSessions.createBrowserContext(PROFILE)
  const sourcePage = await sourceOwner.context.newPage()
  await gotoHydrated(sourcePage, '/')
  const sourceDialog = await openCreateRoomDialog(sourcePage)
  await sourceDialog.getByLabel('Name').fill('Source stream room')
  await sourceDialog.getByRole('button', { name: 'Create Room' }).click()
  await sourcePage.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const sourceRoomId = new URL(sourcePage.url()).pathname.split('/').at(-1)
  const targetOwner = await authSessions.createBrowserContext(TARGET_PROFILE)
  const targetPage = await targetOwner.context.newPage()
  await gotoHydrated(targetPage, '/')
  const targetDialog = await openCreateRoomDialog(targetPage)
  await targetDialog.getByLabel('Name').fill('Full target room')
  await targetDialog.getByRole('button', { name: 'Create Room' }).click()
  await targetPage.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  const fullRoomId = new URL(targetPage.url()).pathname.split('/').at(-1)
  const sourceAccountId = (await authSessions.sql(
    'SELECT id FROM "user" WHERE email = $1',
    [PROFILE.email],
  ) as { id: string }[])[0]?.id
  const targetAccountId = (await authSessions.sql(
    'SELECT id FROM "user" WHERE email = $1',
    [TARGET_PROFILE.email],
  ) as { id: string }[])[0]?.id
  if (!sourceAccountId || !targetAccountId) throw new Error('Missing seeded account')
  await gotoHydrated(sourcePage, `${authSessions.origin}/rooms/${fullRoomId}`)
  await expect(sourcePage.getByRole('button', { name: 'Join' })).toBeVisible()
  await sourcePage.getByRole('button', { name: 'Join' }).click()
  const fullConfirmation = sourcePage.getByRole('dialog', { name: 'Confirm room change' })
  await expect(fullConfirmation).toBeVisible()
  const syntheticAccounts = Array.from({ length: 9 }, () => randomUUID())
  for (const accountId of syntheticAccounts) {
    await authSessions.sql(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ($1, 'Full member', $2, false, now(), now())`,
      [accountId, `${accountId}@example.test`],
    )
    await authSessions.sql(
      `INSERT INTO room_membership (id, room_id, account_id, role, joined_at)
       VALUES ($1, $2, $3, 'member', now())`,
      [randomUUID(), fullRoomId, accountId],
    )
  }
  await fullConfirmation.getByRole('button', { name: 'Confirm' }).click()
  await expect(sourcePage.getByRole('button', { name: 'Full' })).toBeDisabled()
  await expect.poll(async () => {
    const rows = await authSessions.sql(
      'SELECT room_id AS "roomId" FROM room_membership WHERE account_id = $1 AND left_at IS NULL',
      [sourceAccountId],
    ) as { roomId: string }[]
    return rows[0]?.roomId
  }).toBe(sourceRoomId)

  const endedRoomId = randomUUID()
  await authSessions.sql(
    `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_by, created_at)
     VALUES ($1, 'Ended target room', NULL, ARRAY[]::text[], 'public', NULL, $2, now())`,
    [endedRoomId, targetAccountId],
  )
  const sourceMembershipId = (await authSessions.sql(
    'SELECT id FROM room_membership WHERE room_id = $1 AND account_id = $2 AND left_at IS NULL',
    [sourceRoomId, sourceAccountId],
  ) as { id: string }[])[0]?.id
  if (!sourceMembershipId) throw new Error('Missing source membership')
  // Seeded after the navigation for the ADR 0103 reason above.
  await gotoHydrated(sourcePage, `${authSessions.origin}/rooms/${endedRoomId}`)
  await expect(sourcePage.getByRole('button', { name: 'Join' })).toBeVisible()
  await authSessions.sql(
    `INSERT INTO stream (id, room_id, membership_id, started_at)
     VALUES ($1, $2, $3, now())`,
    [randomUUID(), sourceRoomId, sourceMembershipId],
  )
  await sourcePage.getByRole('button', { name: 'Join' }).click()
  const confirmation = sourcePage.getByRole('dialog', { name: 'Confirm room change' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText('current Stream will stop')
  await authSessions.sql('UPDATE room SET ended_at = now() WHERE id = $1', [endedRoomId])
  await confirmation.getByRole('button', { name: 'Confirm' }).click()
  await expect(sourcePage.getByText('Past Stream', { exact: true })).toBeVisible()
  await expect.poll(async () => {
    const rows = await authSessions.sql(
      'SELECT room_id AS "roomId" FROM room_membership WHERE account_id = $1 AND left_at IS NULL',
      [sourceAccountId],
    ) as { roomId: string }[]
    return rows[0]?.roomId
  }).toBe(sourceRoomId)
  const streamState = await authSessions.sql(
    'SELECT ended_at AS "endedAt" FROM stream WHERE membership_id = $1',
    [sourceMembershipId],
  ) as { endedAt: Date | null }[]
  expect(streamState[0]?.endedAt).toBeNull()
  await authSessions.sql('DELETE FROM stream WHERE membership_id = $1', [sourceMembershipId])
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [sourceRoomId])
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [fullRoomId])
  await authSessions.sql('DELETE FROM room_membership WHERE room_id = $1', [endedRoomId])
  await authSessions.sql('DELETE FROM room WHERE id = ANY($1::uuid[])', [[sourceRoomId, fullRoomId, endedRoomId]])
  for (const accountId of syntheticAccounts) {
    await authSessions.sql('DELETE FROM "user" WHERE id = $1', [accountId])
  }
})