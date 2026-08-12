import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  evaluateJourneyMatrix,
  type JourneyExpectations,
  type JourneyRecord,
} from './journey-matrix-lib'

/** Produces the retained V1 journey-matrix artifact for #26.

    By default this runs the full Playwright matrix with retries disabled, then aggregates
    the per-test records the fixture recorder wrote. CI can pass `--records` to evaluate
    records produced by an earlier e2e job without running the browser suite twice. The
    verdict comes from `evaluateJourneyMatrix`, so the acceptance claim is computed from
    observations rather than read off a summary line.

    Usage: pnpm qualify:journey [--records PATH] [--output PATH] */

/** Per-run and outside the working tree, so a concurrent git operation in another session
    cannot delete this run's records while the suite is still writing them. */
const DEFAULT_RECORD_DIRECTORY = join(tmpdir(), `journey-records-${process.pid}`)

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

let output = resolve('test-results/v1-journey-matrix.json')
let recordDirectory: string | undefined
const arguments_ = process.argv.slice(2)
for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index]
  if (argument === '--output' || argument === '--records') {
    const value = arguments_[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a path`)
    }
    if (argument === '--output') output = resolve(value)
    else recordDirectory = resolve(value)
    index += 1
  } else if (argument.startsWith('--')) {
    throw new Error(`Unknown option: ${argument}`)
  }
}

const recordsWereProvided = recordDirectory !== undefined
recordDirectory ??= DEFAULT_RECORD_DIRECTORY
if (!recordsWereProvided) {
  // A stale record from an earlier run would be counted as this run's evidence.
  await rm(recordDirectory, { recursive: true, force: true })
  await mkdir(recordDirectory, { recursive: true })
}

const startedAt = recordsWereProvided ? null : new Date().toISOString()
const exitCode = recordsWereProvided
  ? null
  : await new Promise<number>((resolvePromise, reject) => {
      const child = spawn(
        'pnpm',
        ['test:e2e', '--', '--retries=0', '--reporter=list'],
        {
          stdio: 'inherit',
          env: { ...process.env, JOURNEY_RECORD_DIR: recordDirectory },
        },
      )
      child.on('error', reject)
      child.on('close', (code) => resolvePromise(code ?? 1))
    })

const files = await readdir(recordDirectory)
const records: JourneyRecord[] = await Promise.all(
  files
    .filter((file) => file.endsWith('.json'))
    .map(async (file) => JSON.parse(await readFile(join(recordDirectory, file), 'utf8'))),
)
if (records.length === 0) throw new Error('The matrix produced no journey records')

const evaluated = evaluateJourneyMatrix(records, EXPECTATIONS)
const artifact = {
  schemaVersion: 2,
  startedAt,
  completedAt: new Date().toISOString(),
  runner: {
    command: recordsWereProvided
      ? 'pnpm test:e2e (records supplied by producer job)'
      : 'pnpm test:e2e -- --retries=0',
    playwrightExitCode: exitCode,
  },
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

if (exitCode !== null && exitCode !== 0) {
  throw new Error(`Playwright exited ${exitCode}; the matrix did not pass`)
}
if (evaluated.verdict !== 'pass') {
  const failed = Object.entries(evaluated.checks)
    .filter(([, value]) => !value)
    .map(([name]) => name)
  throw new Error(`Journey matrix verdict failed: ${failed.join(', ')}`)
}
