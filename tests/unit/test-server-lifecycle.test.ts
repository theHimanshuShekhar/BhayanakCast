import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import type { TestEnvironment } from '../helpers/test-environment'
import { TestClock } from '../helpers/test-clock'
import {
  callRuntime,
  startTestServer,
  stopChild,
  waitForReady,
} from '../helpers/test-server'

// These guards bound deliberately stalled OS child processes; fake timers cannot
// drive child-process exit and IPC events.
const RED_TEST_GUARD_MS = 2_000
const CONTRACT_TIMEOUT_MS = 20
const NONREADY_SERVER_FIXTURE = fileURLToPath(
  new URL('../fixtures/nonready-server', import.meta.url),
)

async function forceStop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
}

async function raceWithGuard<T>(operation: Promise<T>) {
  let guardTimer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<{ status: 'guard' }>((resolve) => {
        guardTimer = setTimeout(
          () => resolve({ status: 'guard' }),
          RED_TEST_GUARD_MS,
        )
      }),
    ])
  } finally {
    clearTimeout(guardTimer)
  }
}

test('readiness timeout includes the captured child output', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.stdout.write('readiness diagnostic marker\\n', () => process.send?.('written')); setInterval(() => {}, 1_000)",
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  )

  try {
    await once(child, 'message')
    const outcome = await raceWithGuard(
      waitForReady(child, CONTRACT_TIMEOUT_MS).then(
        () => ({ status: 'resolved' }),
        (error: unknown) => ({
          status: 'rejected',
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
    )

    expect(outcome).toEqual({
      status: 'rejected',
      message: expect.stringMatching(
        /(?:ready|readiness)[\s\S]*readiness diagnostic marker|readiness diagnostic marker[\s\S]*(?:ready|readiness)/i,
      ),
    })
  } finally {
    await forceStop(child)
  }
})

test('startup preserves a nonzero pre-readiness exit diagnostic as the top-level error', async () => {
  const environment: TestEnvironment = {
    workerId: 'diagnostic-worker',
    schema: 'diagnostic_schema',
    valkeyPrefix: 'diagnostic:',
    clock: new TestClock(0),
    databaseUrl: 'postgres://fixture.invalid/database',
    valkeyUrl: 'redis://fixture.invalid',
    async sql() {
      return { rows: [] }
    },
    async set(): Promise<'OK'> {
      return 'OK'
    },
    async get() {
      return null
    },
    async cleanup() {},
  }
  const startup = startTestServer(environment, NONREADY_SERVER_FIXTURE)
  const outcome = await raceWithGuard(
    startup.then(
      async (server) => {
        await server.stop()
        return { status: 'resolved' }
      },
      (error: unknown) => ({
        status: 'rejected',
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      }),
    ),
  )

  expect(outcome).toEqual({
    status: 'rejected',
    name: 'Error',
    message:
      'server exited with 23/null before readiness:\nstartup diagnostic marker\n',
  })
})

test('runtime IPC timeout names the stalled operation', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.on('message', () => {}); process.send?.('armed'); setInterval(() => {}, 1_000)",
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
  )

  try {
    await once(child, 'message')
    const outcome = await raceWithGuard(
      callRuntime(child, 'metrics', {}, CONTRACT_TIMEOUT_MS).then(
        () => ({ status: 'resolved' }),
        (error: unknown) => ({
          status: 'rejected',
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
    )

    expect(outcome).toEqual({
      status: 'rejected',
      message: expect.stringMatching(/metrics/i),
    })
  } finally {
    await forceStop(child)
  }
})

test('a SIGTERM stall escalates to SIGKILL and settles deterministically', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.on('SIGTERM', () => {}); process.send?.('armed'); setInterval(() => {}, 1_000)",
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
  )

  try {
    await once(child, 'message')
    const outcome = await raceWithGuard(
      stopChild(child, CONTRACT_TIMEOUT_MS).then(
        () => ({ status: 'resolved' }),
        (error: unknown) => ({
          status: 'rejected',
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
    )

    expect(outcome).toEqual({
      status: 'rejected',
      message: expect.stringMatching(
        /ignored SIGTERM for (?:the )?20ms grace period and was killed with SIGKILL/i,
      ),
    })
    expect(child.signalCode).toBe('SIGKILL')
  } finally {
    await forceStop(child)
  }
})
