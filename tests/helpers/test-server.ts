import {
  spawn,
  type ChildProcess,
} from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import type { RuntimeBindings } from '../../src/server/runtime'
import type { TestEnvironment } from './test-environment'

const LISTENING = /BhayanakCast listening on http:\/\/127\.0\.0\.1:(\d+)/

export interface TestAuthConfiguration {
  readonly secret: string
  readonly discordClientId: string
  readonly discordClientSecret: string
}

export interface TestServer {
  readonly port: number
  readonly origin: string
  readonly bindings: RuntimeBindings
  readonly auth: TestAuthConfiguration
  sql(text: string, values?: unknown[]): Promise<unknown[]>
  set(key: string, value: string): Promise<'OK'>
  get(key: string): Promise<string | null>
  advanceClock(instant: number): Promise<number>
  stop(): Promise<void>
}

export async function startTestServer(
  environment: TestEnvironment,
): Promise<TestServer> {
  const auth: TestAuthConfiguration = {
    secret: `${randomUUID()}${randomUUID()}`,
    discordClientId: `test-client-${randomUUID()}`,
    discordClientSecret: `test-client-secret-${randomUUID()}`,
  }
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
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
      child.kill('SIGTERM')
      await once(child, 'exit').catch(() => undefined)
    }
    throw error
  }

  const { port, bindings } = ready
  let stopPromise: Promise<void> | undefined
  const callRuntime = <T>(
    operation: string,
    payload: Record<string, unknown>,
  ) =>
    new Promise<T>((resolve, reject) => {
      if (!child.connected || child.exitCode !== null || child.signalCode) {
        reject(new Error('test server is not available'))
        return
      }

      const id = randomUUID()
      const cleanup = () => {
        child.off('message', onMessage)
        child.off('error', onError)
        child.off('exit', onExit)
        child.off('disconnect', onDisconnect)
      }
      const fail = (error: Error) => {
        cleanup()
        reject(error)
      }
      const onMessage = (message: unknown) => {
        if (!isRuntimeResult(message) || message.id !== id) return
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

  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    bindings,
    auth,
    sql: (text, values) => callRuntime('sql', { text, values }),
    set: (key, value) => callRuntime('set', { key, value }),
    get: (key) => callRuntime('get', { key }),
    advanceClock: (instant) => callRuntime('advance-clock', { instant }),
    stop() {
      stopPromise ??= stopChild(child)
      return stopPromise
    },
  }
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    assertCleanExit(child.exitCode, child.signalCode)
    return
  }

  const exited = once(child, 'exit') as Promise<[
    number | null,
    NodeJS.Signals | null,
  ]>
  if (!child.kill('SIGTERM')) {
    throw new Error('failed to signal test server shutdown')
  }
  const [code, signal] = await exited
  assertCleanExit(code, signal)
}

function assertCleanExit(
  code: number | null,
  signal: NodeJS.Signals | null,
) {
  if (code !== 0 || signal !== null) {
    throw new Error(`test server exited abnormally (code ${code}, signal ${signal})`)
  }
}

function waitForReady(child: ChildProcess) {
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
      const cleanup = () => {
        stdout.off('data', onData)
        stderr.off('data', onData)
        child.off('message', onMessage)
        child.off('error', onError)
        child.off('exit', onExit)
      }
      const finish = () => {
        if (port === undefined || bindings === undefined) return
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
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup()
        reject(
          new Error(
            `server exited with ${code}/${signal} before readiness:\n${output}`,
          ),
        )
      }

      stdout.on('data', onData)
      stderr.on('data', onData)
      child.on('message', onMessage)
      child.once('error', onError)
      child.once('exit', onExit)
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
