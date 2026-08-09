import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test, gotoHydrated } from './fixtures'
import { normalizeRoute, viewportStage, type JourneyRecorder } from './journey-evidence'
import type { ViewportStage } from '../../scripts/journey-matrix-lib'

/** The visual and accessibility half of the #26 matrix.

    The passive recorder in `journey-evidence.ts` deliberately never screenshots or scans
    during another spec, because perturbing a run is the one thing a flake-free-run proof
    must not do. This spec owns that capture instead: it walks the canonical V1 journey
    routes at the three accepted stages and records a screenshot plus an axe scan for each
    pair, so the artifact carries real visual and a11y evidence rather than a claim. */

const CAPTURE_DIRECTORY = 'test-results/journey-matrix/screenshots'

const STAGES: readonly { readonly stage: ViewportStage; readonly width: number; readonly height: number }[] = [
  { stage: '390', width: 390, height: 844 },
  { stage: '768-1279', width: 1024, height: 800 },
  { stage: '1280+', width: 1440, height: 900 },
]

const EVIDENCE_HOST = {
  id: '606060606060606001',
  username: 'evidence-host',
  global_name: 'Evidence Host',
  avatar: 'evidence-host-avatar',
  email: 'evidence-host@example.test',
  verified: true,
}

/** Axe's own rule ids are the finding vocabulary; recording every violation rather than
    only the blocking ones keeps a `minor` regression visible without failing the gate. */
async function capture(
  page: Page,
  recorder: JourneyRecorder,
  stage: ViewportStage,
  label: string,
) {
  const route = normalizeRoute(page.url())
  mkdirSync(CAPTURE_DIRECTORY, { recursive: true })
  const file = join(CAPTURE_DIRECTORY, `${label}-${stage}.png`)
  // `caret: 'initial'` matters. Playwright's default hides the text caret by injecting
  // `caret-color: transparent`, which mutates this document and then shows up as an
  // attribute mismatch when the next navigation hydrates. The capture must observe the
  // page, not edit it.
  await page.screenshot({ path: file, caret: 'initial' })
  recorder.recordScreenshot(file)

  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  for (const violation of scan.violations) {
    recorder.recordAxeViolation({
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      route,
      viewportStage: stage,
      targets: violation.nodes.flatMap((node) => node.target.map(String)).slice(0, 10),
      summary: violation.nodes[0]?.failureSummary ?? violation.help,
    })
  }
}

test('the anonymous discovery journey carries visual and accessibility evidence at every stage', async ({
  authSessions,
  journeyEvidence,
  browser,
}) => {
  const context = await browser.newContext({ baseURL: authSessions.origin })
  const page = await context.newPage()
  try {
    for (const { stage, width, height } of STAGES) {
      await page.setViewportSize({ width, height })
      expect(viewportStage(width)).toBe(stage)
      await gotoHydrated(page, '/')
      await capture(page, journeyEvidence, stage, 'home-anonymous')
    }
  } finally {
    await context.close()
  }
})

test('the admitted Room journey carries visual and accessibility evidence at every stage', async ({
  authSessions,
  journeyEvidence,
}) => {
  const { context } = await authSessions.createBrowserContext(EVIDENCE_HOST)
  const page = await context.newPage()

  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHydrated(page, '/')
  await page
    .getByTestId('home-bottom-navigation')
    .getByRole('button', { name: 'Create room' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create Room' })
  await dialog.getByLabel('Name').fill('Journey Evidence')
  await dialog.getByRole('button', { name: 'Create Room' }).click()
  await page.waitForURL(/\/rooms\/[0-9a-f-]+$/)
  await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
  const roomPath = new URL(page.url()).pathname

  for (const { stage, width, height } of STAGES) {
    await page.setViewportSize({ width, height })
    await gotoHydrated(page, roomPath)
    await expect(page.locator('[data-room-state="admitted"]')).toBeVisible()
    await capture(page, journeyEvidence, stage, 'room-admitted')
  }

  await gotoHydrated(page, '/')
  await capture(page, journeyEvidence, '1280+', 'home-signed-in')
})
