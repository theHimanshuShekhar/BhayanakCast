import { describe, expect, it } from 'vitest'
import {
  evaluateJourneyMatrix,
  summarizeJourneyMatrix,
  type JourneyExpectations,
  type JourneyRecord,
} from '../../scripts/journey-matrix-lib'

const expectations: JourneyExpectations = {
  minimumTests: 3,
  requiredRoutes: ['/', '/rooms/:id'],
  requiredStages: ['390', '768-1279', '1280+'],
  minimumMultiAccountTests: 1,
  maximumImpactfulAxeViolations: 0,
  knownHydrationSources: ['StatisticsStrip'],
  inducedFailureSpecs: ['tests/e2e/home-section-recovery.spec.ts'],
}

function record(overrides: Partial<JourneyRecord> = {}): JourneyRecord {
  return {
    title: 'a room admits an explicit Join',
    file: 'tests/e2e/room-shell.spec.ts',
    status: 'passed',
    retry: 0,
    durationMs: 1_200,
    routes: ['/', '/rooms/:id'],
    viewportStages: ['1280+'],
    accountCount: 1,
    interactions: ['click:button[Join]'],
    consoleErrors: [],
    pageErrors: [],
    axeViolations: [],
    screenshots: ['ops/evidence/journey-matrix/home-1280.png'],
    ...overrides,
  }
}

/** Three records that together satisfy every expectation, so a test only has to state
    the one dimension it is about. */
const passing: readonly JourneyRecord[] = [
  record(),
  record({ viewportStages: ['768-1279'], accountCount: 2 }),
  record({ viewportStages: ['390'], file: 'tests/e2e/room-chat.spec.ts' }),
]

describe('journey matrix verdict', () => {
  it('passes only when every matrix expectation holds', () => {
    const evaluated = evaluateJourneyMatrix(passing, expectations)

    expect(evaluated.verdict).toBe('pass')
    expect(Object.values(evaluated.checks).every(Boolean)).toBe(true)
  })

  it.each(
    [
      ['failed test', [record({ status: 'failed' })]],
      ['timed-out test', [record({ status: 'timedOut' })]],
      ['retried test', [record({ retry: 1 })]],
      ['hydration mismatch', [record({ consoleErrors: ["Hydration failed because the server rendered text didn't match"] })]],
      ['unrecognised console error', [record({ consoleErrors: ['Uncaught TypeError: x is not a function'] })]],
      ['unrecognised page error', [record({ pageErrors: ['boom'] })]],
      [
        'critical accessibility violation',
        [
          record({
            axeViolations: [
              {
                id: 'color-contrast',
                impact: 'critical',
                route: '/',
                viewportStage: '390',
                targets: ['.room-shelf__guidance'],
                summary: 'Element has insufficient color contrast',
              },
            ],
          }),
        ],
      ],
    ] satisfies Array<[string, JourneyRecord[]]>,
  )('fails for a plausible %s regression', (_name, regression) => {
    const sessions = [...passing.slice(1), ...regression]

    expect(evaluateJourneyMatrix(sessions, expectations).verdict).toBe('fail')
  })

  /** Route, interaction, and screenshot coverage are properties of the whole run, so one
      thin record cannot sink it — the regression has to remove the evidence everywhere. */
  it('fails when no test ever reaches a required route', () => {
    const homeOnly = passing.map((entry) => ({ ...entry, routes: ['/'] }))
    const evaluated = evaluateJourneyMatrix(homeOnly, expectations)

    expect(evaluated.checks.routeCoverage).toBe(false)
    expect(evaluated.verdict).toBe('fail')
  })

  it('fails when the run recorded no interactions at all', () => {
    const silent = passing.map((entry) => ({ ...entry, interactions: [] }))

    expect(evaluateJourneyMatrix(silent, expectations).checks.interactionsRecorded).toBe(false)
  })

  it('fails when the run captured no screenshots at all', () => {
    const blind = passing.map((entry) => ({ ...entry, screenshots: [] }))

    expect(evaluateJourneyMatrix(blind, expectations).checks.screenshotsRecorded).toBe(false)
  })

  /** Induced network and storage output is tolerated only from a spec that declares it.
      An undeclared spec producing the same output is a real defect, not scenery. */
  it('tolerates induced failures only from the spec that declares them', () => {
    const messages = [
      'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
      'Failed to load resource: net::ERR_INTERNET_DISCONNECTED',
      "Failed to read the 'localStorage' property from 'Window': Access is denied for this document",
    ]
    const declared = record({
      file: 'tests/e2e/home-section-recovery.spec.ts',
      consoleErrors: messages,
    })
    const tolerated = evaluateJourneyMatrix([...passing.slice(1), declared], expectations)

    expect(tolerated.summary.inducedNetworkMessageCount).toBe(2)
    expect(tolerated.summary.inducedStorageMessageCount).toBe(1)
    expect(tolerated.summary.unclassifiedMessages).toEqual([])
    expect(tolerated.verdict).toBe('pass')

    const undeclared = record({ file: 'tests/e2e/room-chat.spec.ts', consoleErrors: messages })
    const regressed = evaluateJourneyMatrix([...passing.slice(1), undeclared], expectations)

    expect(regressed.summary.unclassifiedMessages).toHaveLength(3)
    expect(regressed.checks.noUnclassifiedMessages).toBe(false)
    expect(regressed.verdict).toBe('fail')
  })

  /** A shared CSS class as a quarantine key absorbed a second component's mismatch, which
      is why the key is a component name. */
  it('does not quarantine a second component behind a shared skeleton class', () => {
    const other = record({
      consoleErrors: [
        "Hydration failed: <HomeFilters> ... className=\"home-section-skeleton home-metrics-skeleton\" didn't match",
      ],
    })
    const evaluated = evaluateJourneyMatrix([...passing.slice(1), other], expectations)

    expect(evaluated.checks.noHydrationMismatch).toBe(false)
    expect(evaluated.verdict).toBe('fail')
  })

  /** A named quarantine, not a numeric budget: the ticketed mismatch is tolerated while an
      unrelated one still fails, which a budget of N could not distinguish. */
  it('tolerates only the hydration source that is already ticketed', () => {
    const known = record({
      consoleErrors: ["Hydration failed: <StatisticsStrip statistics={{...}}> didn't match"],
    })
    const evaluated = evaluateJourneyMatrix([...passing.slice(1), known], expectations)

    expect(evaluated.summary.knownHydrationMessageCount).toBe(1)
    expect(evaluated.summary.hydrationMessages).toEqual([])
    expect(evaluated.verdict).toBe('pass')

    const other = record({
      consoleErrors: ["Hydration failed: <RoomControlShelf> didn't match"],
    })
    const regressed = evaluateJourneyMatrix([...passing.slice(1), other], expectations)

    expect(regressed.checks.noHydrationMismatch).toBe(false)
    expect(regressed.verdict).toBe('fail')
  })

  /** A recovery notice is React catching a thrown error, not a server/client disagreement.
      The spec that induces the error may log it; the same notice anywhere else may not. */
  it('separates an induced render recovery from an unexplained one', () => {
    const recovery =
      'There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.'
    const induced = record({
      file: 'tests/e2e/home-section-recovery.spec.ts',
      consoleErrors: [recovery],
    })
    const tolerated = evaluateJourneyMatrix([...passing.slice(1), induced], expectations)

    expect(tolerated.summary.inducedRenderMessageCount).toBe(1)
    expect(tolerated.summary.hydrationMessages).toEqual([])
    expect(tolerated.verdict).toBe('pass')

    const elsewhere = record({ file: 'tests/e2e/room-chat.spec.ts', consoleErrors: [recovery] })
    const regressed = evaluateJourneyMatrix([...passing.slice(1), elsewhere], expectations)

    expect(regressed.checks.noUnexpectedRenderRecovery).toBe(false)
    expect(regressed.verdict).toBe('fail')
  })

  it('fails a cohort of tests that never reaches a required viewport stage', () => {
    const wideOnly = passing.map((entry) => ({ ...entry, viewportStages: ['1280+' as const] }))
    const evaluated = evaluateJourneyMatrix(wideOnly, expectations)

    expect(evaluated.checks.stageCoverage).toBe(false)
    expect(evaluated.verdict).toBe('fail')
  })

  it('fails when no test exercises two Accounts', () => {
    const single = passing.map((entry) => ({ ...entry, accountCount: 1 }))
    const evaluated = evaluateJourneyMatrix(single, expectations)

    expect(evaluated.checks.multiAccountCoverage).toBe(false)
    expect(evaluated.verdict).toBe('fail')
  })

  it('fails a run shorter than the declared minimum', () => {
    expect(evaluateJourneyMatrix(passing.slice(0, 2), expectations).checks.enoughTests).toBe(
      false,
    )
  })

  it('counts a skipped test without failing the run', () => {
    const evaluated = evaluateJourneyMatrix(
      [...passing, record({ status: 'skipped' })],
      expectations,
    )

    expect(evaluated.summary.skippedCount).toBe(1)
    expect(evaluated.verdict).toBe('pass')
  })
})

describe('journey matrix summary', () => {
  it('treats a minor accessibility finding as recorded but not impactful', () => {
    const minor = record({
      axeViolations: [
        {
          id: 'region',
          impact: 'minor',
          route: '/',
          viewportStage: '1280+',
          targets: ['main'],
          summary: 'Some page content is not contained by landmarks',
        },
      ],
    })
    const evaluated = evaluateJourneyMatrix([...passing.slice(1), minor], expectations)

    expect(evaluated.summary.axeViolationsById).toEqual({ region: 1 })
    expect(evaluated.summary.impactfulAxeViolations).toEqual([])
    expect(evaluated.verdict).toBe('pass')
  })

  it('ranks failures by file in descending count', () => {
    const summary = summarizeJourneyMatrix([
      record({ status: 'failed', file: 'tests/e2e/a.spec.ts' }),
      record({ status: 'failed', file: 'tests/e2e/b.spec.ts' }),
      record({ status: 'failed', file: 'tests/e2e/b.spec.ts' }),
    ])

    expect(Object.entries(summary.failuresByFile)).toEqual([
      ['tests/e2e/b.spec.ts', 2],
      ['tests/e2e/a.spec.ts', 1],
    ])
  })

  it('aggregates coverage across records rather than per record', () => {
    const summary = summarizeJourneyMatrix(passing)

    expect(summary.routesCovered).toEqual(['/', '/rooms/:id'])
    expect(summary.stagesCovered).toEqual(['1280+', '390', '768-1279'].sort())
    expect(summary.multiAccountTestCount).toBe(1)
    expect(summary.maxAccountCount).toBe(2)
    expect(summary.interactionCount).toBe(3)
    expect(summary.totalDurationMs).toBe(3_600)
  })
})
