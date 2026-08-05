/** Aggregation and verdict for the #26 V1 journey matrix.

    Kept separate from the driver for the same reason `capacity-qualification-lib.ts` is:
    the verdict is the acceptance claim, so it must be unit-testable against a plausible
    regression without spawning a browser. */

export type ViewportStage = '390' | '768-1279' | '1280+'

export interface AxeViolationRecord {
  readonly id: string
  readonly impact: string
  readonly route: string
  readonly viewportStage: ViewportStage
  /** CSS targets and axe's own failure summary, so a finding is actionable from the
      artifact alone rather than only reproducible by rerunning the scan. */
  readonly targets: readonly string[]
  readonly summary: string
}

export interface JourneyRecord {
  readonly title: string
  readonly file: string
  readonly status: 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped'
  readonly retry: number
  readonly durationMs: number
  readonly routes: readonly string[]
  readonly viewportStages: readonly ViewportStage[]
  readonly accountCount: number
  readonly interactions: readonly string[]
  readonly consoleErrors: readonly string[]
  readonly pageErrors: readonly string[]
  readonly axeViolations: readonly AxeViolationRecord[]
  readonly screenshots: readonly string[]
}

export interface JourneyExpectations {
  readonly minimumTests: number
  readonly requiredRoutes: readonly string[]
  readonly requiredStages: readonly ViewportStage[]
  readonly minimumMultiAccountTests: number
  readonly maximumImpactfulAxeViolations: number
  /** Component or class names naming an already-ticketed hydration mismatch. */
  readonly knownHydrationSources: readonly string[]
  /** Specs that deliberately induce a render failure, so React's recovery notice is the
      behaviour under test rather than a defect. */
  readonly inducedFailureSpecs: readonly string[]
}

/** WCAG findings at these levels are launch-blocking; `minor` and `moderate` are recorded
    for follow-up without failing the gate. */
const IMPACTFUL = ['serious', 'critical']

export type MessageClass =
  | 'hydration'
  | 'known-hydration'
  | 'react-recovery'
  | 'induced-render'
  | 'induced-network'
  | 'induced-storage'
  | 'unclassified'

export interface MessageContext {
  /** Spec file the message came from, used to recognise a deliberately induced failure. */
  readonly file: string
  readonly knownHydrationSources: readonly string[]
  readonly inducedFailureSpecs: readonly string[]
}

/** The suite deliberately provokes offline sockets, denied storage, missing rooms, failing
    refreshes, and failing section queries, so "no console output" was never the right gate
    — it would force those specs to pretend the failure they are testing did not happen.

    What must stay at zero is output that means the product is broken however the test drove
    it, plus anything this classifier does not recognise. An unrecognised message fails the
    matrix rather than passing silently, so a new class of error cannot slip in behind an
    allowlist.

    Two distinctions carry the weight. A *mismatch* ("didn't match") means the server and
    client disagreed and is a defect; a *recovery* notice means React caught a thrown error
    and re-rendered, which is the expected consequence of a spec that induces one. And both
    quarantines are keyed by name — a component for a mismatch, a spec for an induced
    failure — because a numeric budget would silently absorb the next unrelated occurrence
    while a name cannot. */
export function classifyBrowserMessage(
  message: string,
  context: MessageContext = { file: '', knownHydrationSources: [], inducedFailureSpecs: [] },
): MessageClass {
  if (/didn't match|hydrated but some attributes/i.test(message)) {
    return context.knownHydrationSources.some((source) => message.includes(source))
      ? 'known-hydration'
      : 'hydration'
  }
  if (/React was able to recover|error while hydrating/i.test(message)) {
    return context.inducedFailureSpecs.includes(context.file) ? 'induced-render' : 'react-recovery'
  }
  if (/Failed to load resource|net::ERR_/i.test(message)) return 'induced-network'
  if (/Access is denied for this document|localStorage|sessionStorage/i.test(message))
    return 'induced-storage'
  return 'unclassified'
}

function rankByCount(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([, a], [, b]) => b - a))
}

export function summarizeJourneyMatrix(
  records: readonly JourneyRecord[],
  quarantines: Pick<
    JourneyExpectations,
    'knownHydrationSources' | 'inducedFailureSpecs'
  > = { knownHydrationSources: [], inducedFailureSpecs: [] },
) {
  const routes = new Set<string>()
  const stages = new Set<ViewportStage>()
  const axeViolations: AxeViolationRecord[] = []
  let interactionCount = 0
  let consoleErrorCount = 0
  let pageErrorCount = 0
  let screenshotCount = 0
  let totalDurationMs = 0
  let maxAccountCount = 0

  const messagesByClass: Record<MessageClass, string[]> = {
    hydration: [],
    'known-hydration': [],
    'react-recovery': [],
    'induced-render': [],
    'induced-network': [],
    'induced-storage': [],
    unclassified: [],
  }
  for (const entry of records) {
    for (const route of entry.routes) routes.add(route)
    for (const stage of entry.viewportStages) stages.add(stage)
    axeViolations.push(...entry.axeViolations)
    interactionCount += entry.interactions.length
    consoleErrorCount += entry.consoleErrors.length
    pageErrorCount += entry.pageErrors.length
    screenshotCount += entry.screenshots.length
    totalDurationMs += entry.durationMs
    maxAccountCount = Math.max(maxAccountCount, entry.accountCount)
    for (const message of [...entry.consoleErrors, ...entry.pageErrors]) {
      const messageClass = classifyBrowserMessage(message, { file: entry.file, ...quarantines })
      messagesByClass[messageClass].push(`${entry.file}: ${message}`)
    }
  }

  return {
    testCount: records.length,
    passedCount: records.filter((entry) => entry.status === 'passed').length,
    failedCount: records.filter(
      (entry) => entry.status !== 'passed' && entry.status !== 'skipped',
    ).length,
    skippedCount: records.filter((entry) => entry.status === 'skipped').length,
    retriedCount: records.filter((entry) => entry.retry > 0).length,
    routesCovered: [...routes].sort(),
    stagesCovered: [...stages].sort(),
    multiAccountTestCount: records.filter((entry) => entry.accountCount >= 2).length,
    maxAccountCount,
    interactionCount,
    consoleErrorCount,
    pageErrorCount,
    hydrationMessages: messagesByClass.hydration,
    knownHydrationMessageCount: messagesByClass['known-hydration'].length,
    unclassifiedMessages: messagesByClass.unclassified,
    inducedNetworkMessageCount: messagesByClass['induced-network'].length,
    inducedStorageMessageCount: messagesByClass['induced-storage'].length,
    inducedRenderMessageCount: messagesByClass['induced-render'].length,
    reactRecoveryMessages: messagesByClass['react-recovery'],
    impactfulAxeViolations: axeViolations.filter((violation) =>
      IMPACTFUL.includes(violation.impact),
    ),
    screenshotCount,
    totalDurationMs,
    failuresByFile: rankByCount(
      records
        .filter((entry) => entry.status !== 'passed' && entry.status !== 'skipped')
        .map((entry) => entry.file),
    ),
    axeViolationsById: rankByCount(axeViolations.map((violation) => violation.id)),
  }
}

export function evaluateJourneyMatrix(
  records: readonly JourneyRecord[],
  expectations: JourneyExpectations,
) {
  const summary = summarizeJourneyMatrix(records, expectations)
  const checks = {
    enoughTests: summary.testCount >= expectations.minimumTests,
    allPassed: summary.failedCount === 0,
    noRetries: summary.retriedCount === 0,
    routeCoverage: expectations.requiredRoutes.every((route) =>
      summary.routesCovered.includes(route),
    ),
    stageCoverage: expectations.requiredStages.every((stage) =>
      summary.stagesCovered.includes(stage),
    ),
    multiAccountCoverage:
      summary.multiAccountTestCount >= expectations.minimumMultiAccountTests,
    noHydrationMismatch: summary.hydrationMessages.length === 0,
    noUnclassifiedMessages: summary.unclassifiedMessages.length === 0,
    noUnexpectedRenderRecovery: summary.reactRecoveryMessages.length === 0,
    accessibility:
      summary.impactfulAxeViolations.length <= expectations.maximumImpactfulAxeViolations,
    interactionsRecorded: summary.interactionCount > 0,
    screenshotsRecorded: summary.screenshotCount > 0,
  }
  return {
    verdict: Object.values(checks).every(Boolean) ? ('pass' as const) : ('fail' as const),
    checks,
    summary,
  }
}
