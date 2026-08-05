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
  /** Empty, and it must stay that way: a hydration mismatch is a defect, not a budget line.
      #30 removed the last entries by holding the unawaited Home sections on their skeletons
      through the hydration render. */
  knownHydrationSources: [],
  /** Specs that deliberately break something: dropped sockets, denied storage, failing
      section queries, rejected mutations. Their network, storage, and React-recovery output
      is the behaviour under test. The same output from any spec absent here is
      unclassified and fails, so a real 500 cannot hide behind a spec that provokes one. */
  inducedFailureSpecs: [
    'tests/e2e/admin-reports.spec.ts',
    'tests/e2e/admin-room-termination.spec.ts',
    'tests/e2e/admin-sanctions.spec.ts',
    'tests/e2e/create-and-open-room.spec.ts',
    'tests/e2e/home-discovery.spec.ts',
    'tests/e2e/home-reconnect.spec.ts',
    'tests/e2e/home-search.spec.ts',
    'tests/e2e/home-section-recovery.spec.ts',
    'tests/e2e/home-shell.spec.ts',
    'tests/e2e/profile-deletion.spec.ts',
    'tests/e2e/profile-mutes.spec.ts',
    'tests/e2e/profile-theme.spec.ts',
    'tests/e2e/public-profile-boundary.spec.ts',
    'tests/e2e/room-chat.spec.ts',
    'tests/e2e/room-host-transfer.spec.ts',
    'tests/e2e/room-oauth-return.spec.ts',
    'tests/e2e/room-shell.spec.ts',
    'tests/e2e/root-theme.spec.ts',
  ],
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
