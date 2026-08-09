import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import type {
  AxeViolationRecord,
  JourneyRecord,
  ViewportStage,
} from '../../scripts/journey-matrix-lib'

/** Passive evidence recorder for the #26 journey matrix.

    Every listener here only pushes to an array. Nothing in this file awaits inside a
    Playwright event handler, takes a screenshot mid-test, or blocks navigation: the
    matrix exists to prove the suite is flake-free, so the recorder must not be able to
    perturb the run it is measuring. Screenshots and axe scans are therefore collected by
    a dedicated capture spec rather than opportunistically here.

    Records land as one file per test in a temporary directory. Playwright workers are
    separate processes, so a file per test avoids cross-worker coordination. The driver
    passes the directory in; the temporary fallback keeps a bare `pnpm test:e2e` working. */
const RECORD_DIRECTORY =
  process.env.JOURNEY_RECORD_DIR ?? join(tmpdir(), 'bhayanakcast-journey-records')
const MAX_INTERACTIONS = 200
const MAX_MESSAGES = 50

declare global {
  interface Window {
    /** Exposed per context by `instrumentContext`; resolves once the binding is ready. */
    __journeyInteraction?: (entry: string) => Promise<void>
    __journeyCollectorInstalled?: true
  }
}

/** UUID room ids, plus the opaque non-UUID Account ids on `/users/`. Collapsing both keeps
    a route a contract rather than one run's data, and keeps Account identifiers out of a
    committed artifact (ADR 0028). */
const IDENTIFIER_SEGMENT =
  /(?<=\/)(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{16,})(?=\/|$)/g

export function viewportStage(width: number): ViewportStage {
  if (width < 768) return '390'
  if (width < 1280) return '768-1279'
  return '1280+'
}

/** Collapses identifiers so a route is a contract rather than one run's data. */
export function normalizeRoute(url: string): string {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return url
  }
  const collapsed = path.replace(IDENTIFIER_SEGMENT, ':id')
  if (collapsed.length > 1 && collapsed.endsWith('/')) return collapsed.slice(0, -1)
  return collapsed
}

/** Runs in the browser, serialized by `addInitScript`, so it closes over nothing from
    this module.

    Records trusted user input only, so a programmatic `dispatchEvent` from product code
    cannot inflate the interaction evidence. */
function interactionCollector() {
  if (window.__journeyCollectorInstalled) return
  window.__journeyCollectorInstalled = true

  const describe = (node: EventTarget | null): string => {
    if (!(node instanceof Element)) return 'document'
    const role = node.getAttribute('role') ?? node.tagName.toLowerCase()
    const name =
      node.getAttribute('aria-label') ??
      node.getAttribute('name') ??
      (node.textContent ?? '').trim().slice(0, 40)
    return name ? `${role}[${name}]` : role
  }

  let last = ''
  const push = (entry: string) => {
    if (entry === last) return
    last = entry
    // The binding is installed before any init script runs, but a page that navigates
    // while a send is in flight rejects it; evidence is not worth failing a test over.
    void window.__journeyInteraction?.(entry).catch(() => {})
  }

  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted) return
      push(`click:${describe(event.target)}`)
    },
    { capture: true, passive: true },
  )
  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted) return
      push(`keydown:${event.key}`)
    },
    { capture: true, passive: true },
  )
  document.addEventListener(
    'change',
    (event) => {
      if (!event.isTrusted) return
      push(`change:${describe(event.target)}`)
    },
    { capture: true, passive: true },
  )
}

export interface JourneyRecorder {
  instrumentContext(context: BrowserContext): Promise<void>
  recordAccount(): void
  recordScreenshot(path: string): void
  recordAxeViolation(violation: AxeViolationRecord): void
  flush(): Promise<void>
}

export function createJourneyRecorder(testInfo: TestInfo): JourneyRecorder {
  const routes = new Set<string>()
  const stages = new Set<ViewportStage>()
  const interactions = new Set<string>()
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const screenshots: string[] = []
  const axeViolations: AxeViolationRecord[] = []
  let accountCount = 0

  const observePage = (page: Page) => {
    const size = page.viewportSize()
    if (size) stages.add(viewportStage(size.width))

    page.on('console', (message) => {
      if (message.type() !== 'error') return
      if (consoleErrors.length >= MAX_MESSAGES) return
      consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => {
      if (pageErrors.length >= MAX_MESSAGES) return
      pageErrors.push(error.message)
    })
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      const url = frame.url()
      if (!url || url === 'about:blank') return
      routes.add(normalizeRoute(url))
      const current = page.viewportSize()
      if (current) stages.add(viewportStage(current.width))
    })
  }

  return {
    async instrumentContext(context) {
      // A binding, not an array read at teardown: `authSessions` is layered on this
      // fixture, so its contexts close before this one's teardown runs and every page is
      // already gone by then. Pushing each interaction out as it happens removes that
      // ordering dependency entirely.
      await context.exposeBinding('__journeyInteraction', (_source, entry: string) => {
        if (interactions.size < MAX_INTERACTIONS) interactions.add(entry)
      })
      await context.addInitScript(interactionCollector)
      for (const page of context.pages()) observePage(page)
      context.on('page', observePage)
    },
    recordAccount() {
      accountCount += 1
    },
    recordScreenshot(path) {
      screenshots.push(relative(process.cwd(), path))
    },
    recordAxeViolation(violation) {
      axeViolations.push(violation)
    },
    async flush() {
      const record: JourneyRecord = {
        title: testInfo.title,
        file: relative(process.cwd(), testInfo.file),
        status: testInfo.status ?? 'interrupted',
        retry: testInfo.retry,
        durationMs: testInfo.duration,
        routes: [...routes].sort(),
        viewportStages: [...stages].sort(),
        accountCount,
        interactions: [...interactions],
        consoleErrors,
        pageErrors,
        axeViolations,
        screenshots,
      }
      mkdirSync(RECORD_DIRECTORY, { recursive: true })
      writeFileSync(
        join(RECORD_DIRECTORY, `${randomUUID()}.json`),
        `${JSON.stringify(record, null, 2)}\n`,
      )
    },
  }
}
