import {
  spawn,
  type ChildProcess,
} from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { RuntimeBindings } from '../../src/server/runtime'
import type { TestEnvironment } from './test-environment'

const LISTENING = /BhayanakCast listening on http:\/\/127\.0\.0\.1:(\d+)/
const READINESS_TIMEOUT_MS = 10_000
const RUNTIME_TIMEOUT_MS = 10_000
const SHUTDOWN_GRACE_MS = 5_000

export interface TestAuthConfiguration {
  readonly secret: string
  readonly discordClientId: string
  readonly discordClientSecret: string
}

export interface TestServerMetrics {
  readonly eventLoopDelayP99Ms: number
  readonly eventLoopDelayMaxMs: number
}

export interface TestServer {
  readonly port: number
  readonly pid: number
  readonly origin: string
  readonly bindings: RuntimeBindings
  readonly auth: TestAuthConfiguration
  sql(text: string, values?: unknown[]): Promise<unknown[]>
  set(key: string, value: string): Promise<'OK'>
  get(key: string): Promise<string | null>
  advanceClock(instant: number): Promise<number>
  metrics(): Promise<TestServerMetrics>
  stop(): Promise<void>
}

export async function startTestServer(
  environment: TestEnvironment,
  cwd = process.cwd(),
): Promise<TestServer> {
  const auth: TestAuthConfiguration = {
    secret: `${randomUUID()}${randomUUID()}`,
    discordClientId: `test-client-${randomUUID()}`,
    discordClientSecret: `test-client-secret-${randomUUID()}`,
  }
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      DATABASE_URL: environment.databaseUrl,
      DATABASE_SCHEMA: environment.schema,
      VALKEY_URL: environment.valkeyUrl,
      VALKEY_PREFIX: environment.valkeyPrefix,
      TEST_WORKER_ID: environment.workerId,
      CLOCK_EPOCH_MS: String(environment.clock.now()),
      BETTER_AUTH_SECRET: auth.secret,
      DISCORD_CLIENT_ID: auth.discordClientId,
      DISCORD_CLIENT_SECRET: auth.discordClientSecret,
      BETTER_AUTH_URL: '',
      CLOUDFLARED_PUBLIC_URL: '',
      ADMIN_DISCORD_IDS: process.env.TEST_ADMIN_DISCORD_IDS ?? '102938475610293900',
      TRUSTED_PROXY_IPS: '',
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })

  let ready: { port: number; bindings: RuntimeBindings }
  try {
    ready = await waitForReady(child)
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        await stopChild(child)
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'test server startup failed and its child could not be stopped cleanly',
        )
      }
    }
    throw error
  }

  const { port, bindings } = ready
  let stopPromise: Promise<void> | undefined
  const invokeRuntime = <T>(
    operation: string,
    payload: Record<string, unknown>,
  ) => callRuntime<T>(child, operation, payload)

  return {
    pid: child.pid ?? (() => {
      throw new Error('test server did not expose a process id')
    })(),
    port,
    origin: `http://127.0.0.1:${port}`,
    bindings,
    auth,
    sql: (text, values) => invokeRuntime('sql', { text, values }),
    set: (key, value) => invokeRuntime('set', { key, value }),
    get: (key) => invokeRuntime('get', { key }),
    advanceClock: (instant) => invokeRuntime('advance-clock', { instant }),
    metrics: () => invokeRuntime('metrics', {}),
    stop() {
      stopPromise ??= stopChild(child)
      return stopPromise
    },
  }
}

export async function stopChild(
  child: ChildProcess,
  graceMs = SHUTDOWN_GRACE_MS,
) {
  if (child.exitCode !== null || child.signalCode !== null) {
    assertCleanExit(child.exitCode, child.signalCode)
    return
  }

  const terminated = await signalAndWait(child, 'SIGTERM', graceMs)
  if (terminated) {
    assertCleanExit(child.exitCode, child.signalCode)
    return
  }

  const killed = await signalAndWait(child, 'SIGKILL', graceMs)
  if (!killed) {
    throw new Error(
      `test server did not exit after SIGKILL within ${graceMs}ms`,
    )
  }
  if (child.signalCode === 'SIGKILL') {
    throw new Error(
      `test server ignored SIGTERM for ${graceMs}ms grace period and was killed with SIGKILL`,
    )
  }
  assertCleanExit(child.exitCode, child.signalCode)
}

function signalAndWait(
  child: ChildProcess,
  signal: NodeJS.Signals,
  timeoutMs: number,
) {
  return new Promise<boolean>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const settle = (result: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const onError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onExit = () => settle(true)

    child.once('error', onError)
    child.once('exit', onExit)
    timer = setTimeout(() => settle(false), timeoutMs)
    try {
      if (!child.kill(signal)) {
        if (child.exitCode !== null || child.signalCode !== null) settle(true)
        else onError(new Error(`failed to send ${signal} to test server`))
      }
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export function callRuntime<T>(
  child: ChildProcess,
  operation: string,
  payload: Record<string, unknown>,
  timeoutMs = RUNTIME_TIMEOUT_MS,
) {
  return new Promise<T>((resolve, reject) => {
    if (!child.connected || child.exitCode !== null || child.signalCode) {
      reject(new Error('test server is not available'))
      return
    }

    const id = randomUUID()
    let timer: NodeJS.Timeout | undefined
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('error', onError)
      child.off('exit', onExit)
      child.off('disconnect', onDisconnect)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onMessage = (message: unknown) => {
      if (!isRuntimeResult(message) || message.id !== id || settled) return
      settled = true
      cleanup()
      if (message.error) reject(new Error(message.error))
      else resolve(message.result as T)
    }
    const onError = (error: Error) => fail(error)
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      fail(
        new Error(
          `test server exited during ${operation} (code ${code}, signal ${signal})`,
        ),
      )
    const onDisconnect = () =>
      fail(new Error(`test server IPC disconnected during ${operation}`))

    child.on('message', onMessage)
    child.once('error', onError)
    child.once('exit', onExit)
    child.once('disconnect', onDisconnect)
    timer = setTimeout(
      () =>
        fail(
          new Error(
            `test server runtime operation ${operation} timed out after ${timeoutMs}ms`,
          ),
        ),
      timeoutMs,
    )
    try {
      child.send(
        { type: 'runtime-command', id, operation, ...payload },
        (error) => {
          if (error) fail(error)
        },
      )
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function assertCleanExit(
  code: number | null,
  signal: NodeJS.Signals | null,
) {
  if (code !== 0 || signal !== null) {
    throw new Error(`test server exited abnormally (code ${code}, signal ${signal})`)
  }
}

export function waitForReady(
  child: ChildProcess,
  timeoutMs = READINESS_TIMEOUT_MS,
) {
  return new Promise<{ port: number; bindings: RuntimeBindings }>(
    (resolve, reject) => {
      const stdout = child.stdout
      const stderr = child.stderr
      if (!stdout || !stderr) {
        reject(new Error('test server requires piped stdout and stderr'))
        return
      }

      let output = ''
      let port: number | undefined
      let bindings: RuntimeBindings | undefined
      let timer: NodeJS.Timeout | undefined
      let settled = false
      const cleanup = () => {
        clearTimeout(timer)
        stdout.off('data', onData)
        stderr.off('data', onData)
        child.off('message', onMessage)
        child.off('error', onError)
        child.off('exit', onExit)
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const finish = () => {
        if (port === undefined || bindings === undefined || settled) return
        settled = true
        cleanup()
        resolve({ port, bindings })
      }
      const onData = (chunk: Buffer) => {
        output += chunk.toString()
        const match = LISTENING.exec(output)
        if (match) port = Number(match[1])
        finish()
      }
      const onMessage = (message: unknown) => {
        if (!isRuntimeReady(message)) return
        bindings = message.bindings
        finish()
      }
      const onError = (error: Error) => fail(error)
      const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
        fail(
          new Error(
            `server exited with ${code}/${signal} before readiness:\n${output}`,
          ),
        )

      stdout.on('data', onData)
      stderr.on('data', onData)
      child.on('message', onMessage)
      child.once('error', onError)
      child.once('exit', onExit)
      timer = setTimeout(
        () =>
          fail(
            new Error(
              `test server readiness timed out after ${timeoutMs}ms:\n${output}`,
            ),
          ),
        timeoutMs,
      )
    },
  )
}

function isRuntimeReady(
  message: unknown,
): message is { type: 'runtime-ready'; bindings: RuntimeBindings } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'runtime-ready' &&
    'bindings' in message
  )
}

function isRuntimeResult(
  message: unknown,
): message is {
  type: 'runtime-result'
  id: string
  result?: unknown
  error?: string
} {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'runtime-result' &&
    'id' in message &&
    typeof message.id === 'string'
  )
}
