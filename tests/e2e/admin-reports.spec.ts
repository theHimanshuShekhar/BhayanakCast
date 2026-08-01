import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

const ADMIN = { id: '102938475610293900', username: 'report-admin', global_name: 'Report Admin', avatar: 'admin-avatar', email: 'admin@example.test', verified: true }
const REPORTER = { id: '202938475610293901', username: 'reporter', global_name: 'Private Reporter', avatar: 'reporter-avatar', email: 'reporter@example.test', verified: true }

async function sessionId(page: Page) {
  const value: unknown = await (await page.request.get('/api/session')).json()
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') throw new TypeError('Expected session')
  return value.id
}

test('Admin queue/detail covers responsive states, evidence, keyboard resolution, and retention', async ({ authSessions }) => {
  const admin = await authSessions.createBrowserContext(ADMIN)
  const reporter = await authSessions.createBrowserContext(REPORTER)
  const page = await admin.context.newPage()
  const reporterPage = await reporter.context.newPage()
  const adminId = await sessionId(page)
  const reporterId = await sessionId(reporterPage)
  const evidenceReportId = randomUUID()
  const noEvidenceReportId = randomUUID()
  const roomId = randomUUID()
  const membershipId = randomUUID()
  const streamId = randomUUID()
  await authSessions.sql(
    `INSERT INTO room (id, name, category, tags, visibility, password_hash, created_at, ended_at)
     VALUES ($1, 'Evidence room', NULL, ARRAY[]::text[], 'public', NULL, now(), NULL)`,
    [roomId],
  )
  await authSessions.sql(
    `INSERT INTO room_membership (id, room_id, account_id, role, joined_at, left_at)
     VALUES ($1, $2, $3, 'host', now(), NULL)`,
    [membershipId, roomId, reporterId],
  )
  await authSessions.sql(
    `INSERT INTO stream (id, room_id, membership_id, preview_key, preview_updated_at, started_at, ended_at)
     VALUES ($1, $2, $3, $4, now(), now(), NULL)`,
    [streamId, roomId, membershipId, randomUUID()],
  )
  await authSessions.sql(
    `INSERT INTO report
       (id, reporter_account_id, target_type, target_id, room_id, reason, details,
        evidence_content, evidence_content_type, evidence_captured_at, created_at)
     VALUES
       ($1, $3, 'stream', $4, $5, 'privacy', 'Private report details', decode('UklGRgAAAABXRUJQ', 'base64'), 'image/webp', now(), now()),
       ($2, $3, 'account', $3, $5, 'spam', NULL, NULL, NULL, NULL, now())`,
    [evidenceReportId, noEvidenceReportId, reporterId, streamId, roomId],
  )

  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Report queue' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Stream.*Privacy or impersonation/ })).toBeVisible()
  }

  const evidenceLink = page.getByRole('link', { name: /Stream.*Privacy or impersonation/ })
  await evidenceLink.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/admin/reports/${evidenceReportId}`)
  await expect(page.getByRole('heading', { name: 'Structured target review' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Blurred frozen Stream evidence' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dismiss report' })).toBeVisible()
  await expect(page.getByText('Private report details')).toBeVisible()
  const resolve = page.getByRole('button', { name: 'Resolve report' })
  await resolve.focus()
  await resolve.press('Enter')
  const confirm = page.getByRole('button', { name: 'Confirm resolution' })
  await expect(confirm).toBeVisible()
  await confirm.focus()
  await expect(confirm).toBeFocused()
  await confirm.press('Enter')
  await expect(
    page.getByLabel('Admin action').getByText('Resolved', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Retain until')).toBeVisible()
  await expect(authSessions.sql(
    `SELECT report.status, report.retain_until = report.resolved_at + interval '1 year' AS retained,
            audit.action, audit.admin_account_id
       FROM report JOIN report_audit audit ON audit.report_id = report.id WHERE report.id = $1`,
    [evidenceReportId],
  )).resolves.toEqual([{ status: 'resolved', retained: true, action: 'resolved', admin_account_id: adminId }])

  await page.goto(`/admin/reports/${noEvidenceReportId}`)
  await expect(page.getByRole('img', { name: 'Blurred frozen Stream evidence' })).toHaveCount(0)

  await reporterPage.goto('/admin')
  await expect(reporterPage.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await reporterPage.goto('/profile')
  await expect(
    reporterPage.getByText(/report status|report response|report appeal/i),
  ).toHaveCount(0)
})

test('anonymous and ordinary Accounts cannot inspect report detail or evidence', async ({ authSessions, page }) => {
  const reportId = randomUUID()
  const admin = await authSessions.createBrowserContext(ADMIN)
  const adminPage = await admin.context.newPage()
  await adminPage.goto('/admin')
  await expect(adminPage.getByRole('heading', { name: 'No reports to review' })).toBeVisible()
  await adminPage.goto(`/admin/reports/${reportId}`)
  await expect(adminPage.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await page.goto(`/admin/reports/${reportId}`)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  const ordinary = await authSessions.createBrowserContext(REPORTER)
  const ordinaryPage = await ordinary.context.newPage()
  await ordinaryPage.goto(`/admin/reports/${reportId}`)
  await expect(ordinaryPage.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(ordinaryPage.getByRole('img', { name: 'Blurred frozen Stream evidence' })).toHaveCount(0)
})
