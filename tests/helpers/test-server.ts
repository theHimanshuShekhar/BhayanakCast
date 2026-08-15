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
const MAX_CAPTURED_OUTPUT_LENGTH = 16_384

interface ChildOutputCapture {
  output: string
}

const childOutputCaptures = new WeakMap<ChildProcess, ChildOutputCapture>()

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
  readinessTimeoutMs = READINESS_TIMEOUT_MS,
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
  captureChildOutput(child)

  let ready: { port: number; bindings: RuntimeBindings }
  try {
    ready = await waitForReady(child, readinessTimeoutMs)
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      await stopChild(child).catch(() => undefined)
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
  captureChildOutput(child)
  try {
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
        `did not exit after SIGKILL within ${graceMs}ms`,
      )
    }
    if (child.signalCode === 'SIGKILL') {
      throw new Error(
        `ignored SIGTERM for ${graceMs}ms grace period and was killed with SIGKILL`,
      )
    }
    assertCleanExit(child.exitCode, child.signalCode)
  } catch (error) {
    throw lifecycleError(
      'stop',
      error instanceof Error ? error.message : String(error),
      child,
      error,
    )
  }
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
    captureChildOutput(child)
    const operationError = (message: string, cause?: unknown) =>
      lifecycleError(`runtime operation ${operation}`, message, child, cause)
    if (!child.connected || child.exitCode !== null || child.signalCode) {
      reject(operationError('is unavailable'))
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
      if (message.error) reject(operationError(message.error))
      else resolve(message.result as T)
    }
    const onError = (error: Error) =>
      fail(operationError(error.message, error))
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      fail(
        operationError(`exited (code ${code}, signal ${signal})`),
      )
    const onDisconnect = () =>
      fail(operationError('lost its IPC connection'))

    child.on('message', onMessage)
    child.once('error', onError)
    child.once('exit', onExit)
    child.once('disconnect', onDisconnect)
    timer = setTimeout(
      () =>
        fail(
          operationError(`timed out after ${timeoutMs}ms`),
        ),
      timeoutMs,
    )
    try {
      child.send(
        { type: 'runtime-command', id, operation, ...payload },
        (error) => {
          if (error) {
            fail(operationError(`could not be sent: ${error.message}`, error))
          }
        },
      )
    } catch (error) {
      fail(
        operationError(
          `could not be sent: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      )
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

      const capture = captureChildOutput(child)
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
      const onData = () => {
        const match = LISTENING.exec(capture.output)
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
            `server exited with ${code}/${signal} before readiness:\n${capture.output}`,
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
              `test server readiness timed out after ${timeoutMs}ms:\n${capture.output}`,
            ),
          ),
        timeoutMs,
      )
    },
  )
}

function captureChildOutput(child: ChildProcess) {
  const existing = childOutputCaptures.get(child)
  if (existing) return existing

  const capture: ChildOutputCapture = { output: '' }
  const onData = (chunk: Buffer) => {
    const output = capture.output + chunk.toString()
    capture.output = output.length <= MAX_CAPTURED_OUTPUT_LENGTH
      ? output
      : output.slice(-MAX_CAPTURED_OUTPUT_LENGTH)
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.once('close', () => {
    child.stdout?.off('data', onData)
    child.stderr?.off('data', onData)
  })
  childOutputCaptures.set(child, capture)
  return capture
}

function lifecycleError(
  operation: string,
  message: string,
  child: ChildProcess,
  cause?: unknown,
) {
  const output = captureChildOutput(child).output
  const diagnostics = output
    ? `\nCaptured child output:\n${output}`
    : ''
  return new Error(
    `test server ${operation} failed: ${message}${diagnostics}`,
    cause === undefined ? undefined : { cause },
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
