import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

const SCRIPT = 'scripts/usability-acceptance.mjs'
const STEPS = ['sign_in', 'find_room', 'stream_or_watch', 'chat', 'leave'] as const

interface StepOutcome {
  result: 'pass' | 'fail'
  seconds: number
  difficulty?: number
  obstacle?: string
  observation?: string
}

type Session = Record<string, unknown>

const directory = mkdtempSync(join(tmpdir(), 'usability-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

let files = 0

/** Ten slots that satisfy every §1 minimum, so the default cohort is representative and
    a test only has to state the one dimension it is about. */
const REPRESENTATIVE_CLIENTS = [
  'ios-safari',
  'android-chrome',
  'ios-safari',
  'chrome-desktop',
  'chrome-desktop',
  'firefox-desktop',
  'safari-desktop',
  'chrome-desktop',
  'edge-desktop',
  'chrome-desktop',
]
const REPRESENTATIVE_VIEWPORTS = [
  '390',
  '390',
  '390',
  '768-1279',
  '768-1279',
  '1280+',
  '1280+',
  '1280+',
  '1280+',
  '1280+',
]

/** Participant codes are unique per file, so numbering restarts for every cohort the
    helper builds rather than drifting toward the P## cap across the suite. */
function cohort(
  size: number,
  shape: (index: number) => { session?: Session; steps?: Partial<Record<string, StepOutcome>> } = () => ({}),
): Session[] {
  return Array.from({ length: size }, (_unused, index) => {
    const { session: overrides = {}, steps = {} } = shape(index)
    return {
      participant: `P${String(index).padStart(2, '0')}`,
      consent: true,
      consent_at: '2026-08-02T10:00:00.000Z',
      // A representative cohort by default, so a test only states the dimension it is about.
      client: REPRESENTATIVE_CLIENTS[index % REPRESENTATIVE_CLIENTS.length],
      viewport_stage: REPRESENTATIVE_VIEWPORTS[index % REPRESENTATIVE_VIEWPORTS.length],
      facilitator: 'FA',
      observer: 'OB',
      // Slot 3 is a desktop slot, so it carries the §1 keyboard-only session by default.
      keyboard_only: index % REPRESENTATIVE_CLIENTS.length === 3,
      ...(index % REPRESENTATIVE_CLIENTS.length === 3
        ? { keyboard_findings: 'Focus order held; the focus ring was faint on the watch control.' }
        : {}),
      replay_console_a11y: 'none',
      struck: false,
      steps: Object.fromEntries(
        STEPS.map((step) => [step, steps[step] ?? { result: 'pass', seconds: 20, difficulty: 2 }]),
      ),
      ...overrides,
    }
  })
}

function run(sessions: Session[]) {
  files += 1
  const file = join(directory, `results-${files}.json`)
  writeFileSync(file, JSON.stringify({ build: 'abc123', origin: 'http://localhost:3000', sessions }))
  const result = spawnSync(process.execPath, [SCRIPT, file], { cwd: process.cwd(), encoding: 'utf8' })
  return {
    status: result.status,
    stderr: result.stderr,
    report: result.stdout.trim() ? JSON.parse(result.stdout) : undefined,
  }
}

const failedStep = (obstacle: string): StepOutcome => ({
  result: 'fail',
  seconds: 240,
  difficulty: 5,
  obstacle,
  observation: 'Looked in the wrong region and then stopped.',
})

describe('the launch gate', () => {
  test('passes when a representative cohort completes unaided', () => {
    const { status, report } = run(cohort(10))

    expect(status).toBe(0)
    expect(report.gate).toBe('met')
    expect(report.rate).toBe(1)
    expect(report.qualifying_sessions).toBe(10)
    expect(report.cohort_shortfalls).toEqual([])
  })

  test('holds the 90% boundary exactly', () => {
    const { status, report } = run(
      cohort(10, (index) => (index === 0 ? { steps: { chat: failedStep('aided') } } : {})),
    )

    expect(status).toBe(0)
    expect(report.rate).toBe(0.9)
    expect(report.gate).toBe('met')
  })

  test('fails at 80% and reports how many more completions the cohort needs', () => {
    const { status, stderr, report } = run(
      cohort(10, (index) => (index < 2 ? { steps: { chat: failedStep('not_found') } } : {})),
    )

    expect(status).toBe(1)
    expect(report.gate).toBe('failed')
    expect(report.rate).toBe(0.8)
    expect(stderr).toContain('1 more unaided completion(s) required')
  })

  test('rounds the shortfall up when 90% of the cohort is fractional', () => {
    // 12 sessions, 9 unaided: 0.75. Nine of twelve clears nothing, but ceil(0.9 * 12) = 11,
    // so two more are needed — floor or round would understate it.
    const { stderr, report } = run(
      cohort(12, (index) => (index < 3 ? { steps: { leave: failedStep('abandoned') } } : {})),
    )

    expect(report.rate).toBe(0.75)
    expect(stderr).toContain('2 more unaided completion(s) required')
  })

  test('counts a defect-blocked step against the gate', () => {
    const { status, report } = run(
      cohort(10, (index) => (index < 3 ? { steps: { stream_or_watch: failedStep('blocked_by_defect') } } : {})),
    )

    expect(status).toBe(1)
    expect(report.gate).toBe('failed')
    expect(report.failures_by_obstacle).toEqual({ blocked_by_defect: 3 })
  })

  test('excludes dry runs and struck sessions from both numerator and denominator', () => {
    const sessions = [
      ...cohort(10),
      { ...cohort(1)[0], participant: 'P50', dry_run: true },
      {
        ...cohort(1)[0],
        participant: 'P51',
        struck: true,
        strike_reason: 'saw an internal demo',
        steps: { sign_in: { result: 'pass', seconds: 20, difficulty: 1 } },
      },
    ]

    const { status, report } = run(sessions)

    expect(status).toBe(0)
    expect(report.sessions_recorded).toBe(12)
    expect(report.qualifying_sessions).toBe(10)
    expect(report.dry_runs).toBe(1)
    expect(report.struck).toBe(1)
  })
})

describe('cohort representativeness', () => {
  test('treats an empty cohort as unproven rather than met', () => {
    const { status, stderr, report } = run([])

    expect(status).toBe(1)
    expect(report.gate).toBe('unproven')
    expect(stderr).toContain('cohort of 0 is below the 10-session minimum')
  })

  test('refuses to certify a single all-pass session', () => {
    const { status, stderr, report } = run(cohort(1))

    expect(status).toBe(1)
    expect(report.rate).toBe(1)
    expect(report.gate).toBe('unproven')
    expect(stderr).toContain('below the 10-session minimum')
  })

  test('refuses an all-Chromium-desktop cohort', () => {
    const { status, report } = run(
      cohort(10, () => ({ session: { client: 'chrome-desktop', viewport_stage: '1280+' } })),
    )

    expect(status).toBe(1)
    expect(report.gate).toBe('unproven')
    expect(report.cohort_shortfalls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('0 mobile sessions'),
        expect.stringContaining('0 non-Chromium sessions'),
        expect.stringContaining('0 sessions at 390'),
        expect.stringContaining('0 iOS Safari sessions'),
      ]),
    )
  })

  test('refuses a cohort missing one supported mobile client', () => {
    // The only change from a representative cohort: the Android slot becomes a second iPhone.
    const { status, report } = run(
      cohort(10, (index) => ({ session: index === 1 ? { client: 'ios-safari' } : {} })),
    )

    expect(status).toBe(1)
    expect(report.cohort_shortfalls).toEqual([expect.stringContaining('0 Android Chrome sessions')])
  })

  test('rejects a client outside the ADR 0014 supported population', () => {
    const { status, stderr } = run(cohort(10, (index) => ({ session: index === 0 ? { client: 'opera-mini' } : {} })))

    expect(status).toBe(1)
    expect(stderr).toContain('must be a supported client')
  })

  test('refuses a cohort with no keyboard-only session', () => {
    const { status, report } = run(cohort(10, () => ({ session: { keyboard_only: false } })))

    expect(status).toBe(1)
    expect(report.rate).toBe(1)
    expect(report.gate).toBe('unproven')
    expect(report.keyboard_only_sessions).toBe(0)
    expect(report.cohort_shortfalls).toEqual([expect.stringContaining('0 keyboard-only sessions')])
  })

  test('rejects a keyboard-only session recorded on a mobile client', () => {
    // Keyboard-only is a desktop claim; a touch client cannot evidence focus order.
    const { status, stderr } = run(cohort(10, (index) => ({ session: index === 0 ? { keyboard_only: true } : {} })))

    expect(status).toBe(1)
    expect(stderr).toContain('§1 requires a desktop session')
  })
})

describe('failure attribution', () => {
  test('categorizes every failure by step, viewport stage, client, and obstacle', () => {
    const sessions = cohort(10, (index) => {
      if (index === 0)
        return {
          session: { client: 'ios-safari', viewport_stage: '390' },
          steps: { stream_or_watch: failedStep('not_found') },
        }
      if (index === 3)
        return {
          session: { client: 'firefox-desktop', viewport_stage: '768-1279' },
          steps: { stream_or_watch: failedStep('wrong_mental_model'), leave: failedStep('not_found') },
        }
      return {}
    })

    const { report } = run(sessions)

    expect(report.failures_by_step).toEqual({ stream_or_watch: 2, leave: 1 })
    expect(report.failures_by_viewport_stage).toEqual({ '768-1279': 2, '390': 1 })
    expect(report.failures_by_client).toEqual({ 'firefox-desktop': 2, 'ios-safari': 1 })
    expect(report.failures_by_obstacle).toEqual({ not_found: 2, wrong_mental_model: 1 })
  })
})

describe('capture integrity', () => {
  test('rejects prohibited product content nested inside a step', () => {
    const { status, stderr } = run(
      cohort(10, (index) =>
        index === 0 ? { steps: { chat: { result: 'pass', seconds: 20, difficulty: 1, chat_body: 'hello' } } } : {},
      ),
    )

    expect(status).toBe(1)
    expect(stderr).toContain('holds prohibited product content')
  })

  test('rejects prohibited product content at the top of a session', () => {
    const { status, stderr } = run(cohort(10, (index) => (index === 0 ? { session: { email: 'a@b.c' } } : {})))

    expect(status).toBe(1)
    expect(stderr).toContain('sessions[0].email holds prohibited product content')
  })

  test('rejects a pass recorded past the 240-second cap', () => {
    const { status, stderr } = run(
      cohort(10, (index) => (index === 0 ? { steps: { leave: { result: 'pass', seconds: 900, difficulty: 3 } } } : {})),
    )

    expect(status).toBe(1)
    expect(stderr).toContain('passed after 900s')
  })

  test('rejects a pass that carries an obstacle code', () => {
    const { status, stderr } = run(
      cohort(10, (index) =>
        index === 0 ? { steps: { chat: { result: 'pass', seconds: 20, difficulty: 2, obstacle: 'aided' } } } : {},
      ),
    )

    expect(status).toBe(1)
    expect(stderr).toContain('passed while carrying obstacle aided')
  })

  test('rejects a failure with no observation', () => {
    const { status, stderr } = run(
      cohort(10, (index) =>
        index === 0
          ? { steps: { chat: { result: 'fail', seconds: 100, difficulty: 4, obstacle: 'not_found' } } }
          : {},
      ),
    )

    expect(status).toBe(1)
    expect(stderr).toContain('failed without a one-sentence observation')
  })

  test('rejects one person holding both roles', () => {
    const { status, stderr } = run(
      cohort(10, (index) => (index === 0 ? { session: { facilitator: 'FA', observer: 'FA' } } : {})),
    )

    expect(status).toBe(1)
    expect(stderr).toContain('one person in both roles')
  })

  test.each([
    ['a session without consent', { consent: false }, 'no recorded consent'],
    ['a session with no consent timestamp', { consent_at: undefined }, 'consent_at is required'],
    ['a struck session with no reason', { struck: true }, 'strike_reason'],
    ['an unknown viewport stage', { viewport_stage: '480' }, 'viewport_stage must be one of'],
    ['an identifying participant code', { participant: 'Alice' }, 'participant must match P##'],
    ['a session with no observer', { observer: undefined }, 'needs both a facilitator and a separate observer'],
  ])('rejects %s', (_label, overrides, message) => {
    const { status, stderr } = run(cohort(10, (index) => (index === 0 ? { session: overrides as Session } : {})))

    expect(status).toBe(1)
    expect(stderr).toContain(message as string)
  })

  test.each([
    ['no obstacle code', { result: 'fail', seconds: 30, difficulty: 4 }, 'failed without a valid obstacle'],
    [
      'an unrecognized obstacle code',
      { result: 'fail', seconds: 30, difficulty: 4, obstacle: 'user_was_tired' },
      'failed without a valid obstacle',
    ],
    ['no difficulty rating', { result: 'pass', seconds: 30 }, 'difficulty must be an integer from 1 to 5'],
    [
      'a difficulty outside 1-5',
      { result: 'pass', seconds: 30, difficulty: 9 },
      'difficulty must be an integer from 1 to 5',
    ],
  ])('rejects a step with %s', (_label, outcome, message) => {
    const { status, stderr } = run(
      cohort(10, (index) => (index === 0 ? { steps: { chat: outcome as StepOutcome } } : {})),
    )

    expect(status).toBe(1)
    expect(stderr).toContain(message as string)
  })

  test('rejects a duplicated participant code', () => {
    const sessions = cohort(10)
    sessions[1].participant = sessions[0].participant

    const { status, stderr } = run(sessions)

    expect(status).toBe(1)
    expect(stderr).toContain('is duplicated')
  })

  test('rejects a scored session missing a journey step', () => {
    const sessions = cohort(10)
    delete (sessions[0].steps as Record<string, unknown>).leave

    const { status, stderr } = run(sessions)

    expect(status).toBe(1)
    expect(stderr).toContain('steps.leave is missing')
  })

  test('accepts a struck session that stopped part-way through', () => {
    const sessions = [
      ...cohort(10),
      {
        ...cohort(1)[0],
        participant: 'P60',
        struck: true,
        strike_reason: 'disclosed exclusion at step two',
        steps: { sign_in: { result: 'pass', seconds: 30, difficulty: 1 } },
      },
    ]

    const { status, report } = run(sessions)

    expect(status).toBe(0)
    expect(report.struck).toBe(1)
    expect(report.qualifying_sessions).toBe(10)
  })

  test('rejects a scored session with no post-session replay finding', () => {
    const sessions = cohort(10)
    delete sessions[5].replay_console_a11y

    const { status, stderr } = run(sessions)

    expect(status).toBe(1)
    expect(stderr).toContain('replay_console_a11y is required')
  })

  test('rejects the keyboard-only session when it carries no keyboard findings', () => {
    const sessions = cohort(10)
    delete sessions[3].keyboard_findings

    const { status, stderr } = run(sessions)

    expect(status).toBe(1)
    expect(stderr).toContain('must carry keyboard_findings')
  })

  test('rejects a session with no recorded keyboard_only decision', () => {
    const sessions = cohort(10)
    delete sessions[0].keyboard_only

    const { status, stderr } = run(sessions)

    expect(status).toBe(1)
    expect(stderr).toContain('keyboard_only must be recorded as a boolean')
  })
})

test('the committed results template is valid and does not certify the gate', () => {
  const result = spawnSync(process.execPath, [SCRIPT, 'docs/operations/usability-results.template.json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  expect(result.status).toBe(1)
  expect(JSON.parse(result.stdout).gate).toBe('unproven')
  expect(result.stderr).not.toContain('sessions[')
})
