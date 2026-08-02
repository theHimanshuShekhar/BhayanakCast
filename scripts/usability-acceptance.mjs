import { readFile } from 'node:fs/promises'

const input = process.argv[2]
if (!input) throw new Error('Usage: node scripts/usability-acceptance.mjs RESULTS_FILE')

const THRESHOLD = 0.9
const MINIMUM_COHORT = 10
const STEP_TIME_CAP_SECONDS = 240
const STEPS = ['sign_in', 'find_room', 'stream_or_watch', 'chat', 'leave']
const OBSTACLES = [
  'not_found',
  'wrong_mental_model',
  'blocked_by_permission',
  'blocked_by_latency',
  'blocked_by_defect',
  'abandoned',
  'aided',
]
const VIEWPORT_STAGES = ['390', '768-1279', '1280+']

/** ADR 0014 fixes the compatibility-supported population; a client outside it cannot
    contribute evidence for a criterion scoped to that population. */
const CLIENTS = {
  'chrome-desktop': { form: 'desktop', engine: 'chromium' },
  'edge-desktop': { form: 'desktop', engine: 'chromium' },
  'firefox-desktop': { form: 'desktop', engine: 'gecko' },
  'safari-desktop': { form: 'desktop', engine: 'webkit' },
  'ios-safari': { form: 'mobile', engine: 'webkit' },
  'android-chrome': { form: 'mobile', engine: 'chromium' },
}

const PROHIBITED_KEYS = [
  'chat_body',
  'message',
  'body',
  'password',
  'email',
  'discord_handle',
  'discord_id',
  'real_name',
  'name',
  'token',
  'credential',
]

function assertNoProhibitedKeys(value, path) {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) assertNoProhibitedKeys(entry, `${path}[${index}]`)
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (PROHIBITED_KEYS.includes(key)) throw new Error(`${path}.${key} holds prohibited product content`)
    assertNoProhibitedKeys(entry, `${path}.${key}`)
  }
}

const document = JSON.parse(await readFile(input, 'utf8'))
if (!Array.isArray(document.sessions)) throw new Error(`${input} has no sessions array`)

const seenCodes = new Set()
for (const [index, session] of document.sessions.entries()) {
  const at = `sessions[${index}]`
  assertNoProhibitedKeys(session, at)

  if (typeof session.participant !== 'string' || !/^P\d\d$/.test(session.participant))
    throw new Error(`${at}.participant must match P##`)
  if (seenCodes.has(session.participant)) throw new Error(`${at}.participant ${session.participant} is duplicated`)
  seenCodes.add(session.participant)

  if (session.consent !== true) throw new Error(`${at} has no recorded consent`)
  if (!session.consent_at) throw new Error(`${at}.consent_at is required`)
  if (!VIEWPORT_STAGES.includes(session.viewport_stage))
    throw new Error(`${at}.viewport_stage must be one of ${VIEWPORT_STAGES.join(', ')}`)
  if (!Object.hasOwn(CLIENTS, session.client))
    throw new Error(`${at}.client must be a supported client: ${Object.keys(CLIENTS).join(', ')}`)

  if (!session.facilitator || !session.observer)
    throw new Error(`${at} needs both a facilitator and a separate observer`)
  if (session.facilitator === session.observer)
    throw new Error(`${at} has one person in both roles; the session is struck, not scored`)

  if (session.struck === true) {
    if (!session.strike_reason) throw new Error(`${at} is struck without a strike_reason`)
    continue
  }

  for (const step of STEPS) {
    const outcome = session.steps?.[step]
    const where = `${at}.steps.${step}`
    if (!outcome) throw new Error(`${where} is missing`)
    if (outcome.result !== 'pass' && outcome.result !== 'fail')
      throw new Error(`${where}.result must be pass or fail`)
    if (!Number.isFinite(outcome.seconds) || outcome.seconds < 0)
      throw new Error(`${where}.seconds must be a non-negative number`)
    if (!Number.isInteger(outcome.difficulty) || outcome.difficulty < 1 || outcome.difficulty > 5)
      throw new Error(`${where}.difficulty must be an integer from 1 to 5`)

    if (outcome.result === 'pass') {
      if (outcome.seconds > STEP_TIME_CAP_SECONDS)
        throw new Error(`${where} passed after ${outcome.seconds}s; past ${STEP_TIME_CAP_SECONDS}s the step failed`)
      if (outcome.obstacle) throw new Error(`${where} passed while carrying obstacle ${outcome.obstacle}`)
      continue
    }

    if (!OBSTACLES.includes(outcome.obstacle))
      throw new Error(`${where} failed without a valid obstacle code`)
    if (!outcome.observation) throw new Error(`${where} failed without a one-sentence observation`)
  }
}

const qualifying = document.sessions.filter((session) => session.struck !== true && session.dry_run !== true)
const completed = qualifying.filter((session) => STEPS.every((step) => session.steps[step].result === 'pass'))
const rate = qualifying.length === 0 ? 0 : completed.length / qualifying.length

const count = (predicate) => qualifying.filter(predicate).length
const shortfalls = []
if (qualifying.length < MINIMUM_COHORT)
  shortfalls.push(`cohort of ${qualifying.length} is below the ${MINIMUM_COHORT}-session minimum`)
for (const [label, minimum, predicate] of [
  ['mobile sessions', 3, (session) => CLIENTS[session.client].form === 'mobile'],
  ['desktop sessions', 5, (session) => CLIENTS[session.client].form === 'desktop'],
  ['non-Chromium sessions', 2, (session) => CLIENTS[session.client].engine !== 'chromium'],
  ['sessions at 390', 3, (session) => session.viewport_stage === '390'],
  ['sessions at 768-1279', 2, (session) => session.viewport_stage === '768-1279'],
  ['sessions at 1280+', 4, (session) => session.viewport_stage === '1280+'],
  ['iOS Safari sessions', 1, (session) => session.client === 'ios-safari'],
  ['Android Chrome sessions', 1, (session) => session.client === 'android-chrome'],
]) {
  const actual = count(predicate)
  if (actual < minimum) shortfalls.push(`${actual} ${label}, below the required ${minimum}`)
}

const failures = []
for (const session of qualifying) {
  for (const step of STEPS) {
    const outcome = session.steps[step]
    if (outcome.result === 'fail')
      failures.push({
        step,
        viewport_stage: session.viewport_stage,
        client: session.client,
        obstacle: outcome.obstacle,
      })
  }
}

const tally = (key) =>
  Object.fromEntries(
    Object.entries(
      failures.reduce((counts, failure) => {
        counts[failure[key]] = (counts[failure[key]] ?? 0) + 1
        return counts
      }, {}),
    ).sort(([, a], [, b]) => b - a),
  )

const gate = shortfalls.length > 0 ? 'unproven' : rate >= THRESHOLD ? 'met' : 'failed'

const report = {
  computed_at: new Date().toISOString(),
  results_file: input,
  build: document.build ?? null,
  origin: document.origin ?? null,
  sessions_recorded: document.sessions.length,
  dry_runs: document.sessions.filter((session) => session.dry_run === true).length,
  struck: document.sessions.filter((session) => session.struck === true).length,
  qualifying_sessions: qualifying.length,
  unaided_completions: completed.length,
  rate: Number(rate.toFixed(4)),
  threshold: THRESHOLD,
  gate,
  cohort_shortfalls: shortfalls,
  failures_by_step: tally('step'),
  failures_by_viewport_stage: tally('viewport_stage'),
  failures_by_client: tally('client'),
  failures_by_obstacle: tally('obstacle'),
}

console.log(JSON.stringify(report, null, 2))

if (gate === 'unproven')
  throw new Error(`gate unproven: this is not a representative cohort — ${shortfalls.join('; ')}`)
if (gate === 'failed') {
  const needed = Math.ceil(THRESHOLD * qualifying.length) - completed.length
  throw new Error(
    `gate failed: ${completed.length}/${qualifying.length} unaided (${report.rate}) below ${THRESHOLD}; ${needed} more unaided completion(s) required at this cohort size`,
  )
}
