import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  evaluateJourneyMatrix,
  type JourneyExpectations,
  type JourneyRecord,
} from './journey-matrix-lib'

/** Produces the retained V1 journey-matrix artifact for #26.

    Runs the full Playwright matrix with retries disabled, then aggregates the per-test
    records the fixture recorder wrote. The verdict comes from `evaluateJourneyMatrix`, so
    the acceptance claim is computed from observations rather than read off a summary line.

    Usage: pnpm qualify:journey [--output PATH] */

const RECORD_DIRECTORY = resolve('ops/evidence/journey-matrix/records')

/** The canonical V1 journey from ADR 0013: discovery, a live room, and a public profile.
    A matrix that never reaches one of these is not the V1 contract, whatever it reports. */
const EXPECTATIONS: JourneyExpectations = {
  minimumTests: 100,
  requiredRoutes: ['/', '/rooms/:id'],
  requiredStages: ['390', '768-1279', '1280+'],
  minimumMultiAccountTests: 5,
  /** #30: Home streams statistics into a shape-matched skeleton per DESIGN.md, but the
      branch is a manual `pending` boolean rather than a Suspense boundary, so when the
      dehydrated payload lands before hydration the client renders the resolved section
      against the server's skeleton. Quarantined by component name so any other component
      producing a mismatch still fails this gate; #30 empties this list. */
  knownHydrationSources: ['StatisticsStrip', 'home-metrics-skeleton'],
  /** This spec makes Home section queries fail on purpose to prove inline Retry, so React's
      "recovered by re-rendering" notice is the behaviour under test. Named, not budgeted:
      the same notice from any other spec still fails the matrix. */
  inducedFailureSpecs: ['tests/e2e/home-section-recovery.spec.ts'],
  maximumImpactfulAxeViolations: 0,
}

let output = resolve('ops/evidence/v1-journey-matrix.json')
for (let index = 0; index < process.argv.length - 2; index += 1) {
  const argument = process.argv[index + 2]
  if (argument === '--output') output = resolve(process.argv[index + 3] ?? '')
  else if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`)
}

// A stale record from an earlier run would be counted as this run's evidence.
await rm(RECORD_DIRECTORY, { recursive: true, force: true })
await mkdir(RECORD_DIRECTORY, { recursive: true })

const startedAt = new Date().toISOString()
const exitCode = await new Promise<number>((resolvePromise, reject) => {
  const child = spawn(
    'pnpm',
    ['test:e2e', '--', '--retries=0', '--reporter=list'],
    { stdio: 'inherit' },
  )
  child.on('error', reject)
  child.on('close', (code) => resolvePromise(code ?? 1))
})

const files = await readdir(RECORD_DIRECTORY)
const records: JourneyRecord[] = await Promise.all(
  files
    .filter((file) => file.endsWith('.json'))
    .map(async (file) => JSON.parse(await readFile(join(RECORD_DIRECTORY, file), 'utf8'))),
)
if (records.length === 0) throw new Error('The matrix produced no journey records')

const evaluated = evaluateJourneyMatrix(records, EXPECTATIONS)
const artifact = {
  schemaVersion: 1,
  startedAt,
  completedAt: new Date().toISOString(),
  runner: { command: 'pnpm test:e2e -- --retries=0', playwrightExitCode: exitCode },
  expectations: EXPECTATIONS,
  verdict: evaluated.verdict,
  checks: evaluated.checks,
  summary: evaluated.summary,
  // Sorted so an unchanged suite produces a diffable artifact rather than worker-order noise.
  tests: [...records].sort((first, second) =>
    `${first.file}${first.title}`.localeCompare(`${second.file}${second.title}`),
  ),
}
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`)

console.log(
  JSON.stringify(
    { output, verdict: artifact.verdict, checks: artifact.checks, summary: artifact.summary },
    null,
    2,
  ),
)

if (exitCode !== 0) throw new Error(`Playwright exited ${exitCode}; the matrix did not pass`)
if (evaluated.verdict !== 'pass') {
  const failed = Object.entries(evaluated.checks)
    .filter(([, value]) => !value)
    .map(([name]) => name)
  throw new Error(`Journey matrix verdict failed: ${failed.join(', ')}`)
}
