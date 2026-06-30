import { once } from 'node:events'
import { createConnection } from 'node:net'
import { connect as connectTls } from 'node:tls'
import type { Socket } from 'node:net'
import { readServerEnv } from './env'
import { logEvent } from './logger'

export type RateLimitRule = {
  limit: number
  windowMs: number
}

export const rateLimitRules = {
  roomCreate: { limit: 5, windowMs: 60 * 60 * 1000 },
  chatMessage: { limit: 30, windowMs: 60 * 1000 },
  reportCreate: { limit: 10, windowMs: 60 * 60 * 1000 },
  streamThumbnail: { limit: 1, windowMs: 110 * 1000 },
  streamCommand: { limit: 10, windowMs: 60 * 1000 },
  privateRoomPassword: { limit: 10, windowMs: 10 * 60 * 1000 },
} satisfies Record<string, RateLimitRule>

export const rateLimitKeys = {
  roomCreate: (userId: string) => `rate:room:create:${userId}`,
  chatMessage: (userId: string, roomId: string) =>
    `rate:chat:${userId}:${roomId}`,
  reportCreate: (userId: string) => `rate:report:${userId}`,
  streamThumbnail: (streamSessionId: string) =>
    `rate:stream:thumbnail:${streamSessionId}`,
  streamCommand: (userId: string, roomId: string) =>
    `rate:stream:command:${userId}:${roomId}`,
  privateRoomPassword: (userId: string, roomId: string, ip: string) =>
    `rate:room:password:${userId}:${roomId}:${ip}`,
}

export class RateLimitError extends Error {
  readonly code = 'RATE_LIMITED'

  constructor() {
    super('RATE_LIMITED')
  }
}

export type RateLimitStore = {
  increment: (key: string, windowMs: number) => Promise<number>
}

class MemoryRateLimitStore implements RateLimitStore {
  private readonly values = new Map<
    string,
    { count: number; expiresAt: number }
  >()

  constructor(private readonly now = () => Date.now()) {}

  async increment(key: string, windowMs: number) {
    const currentTime = this.now()
    const existing = this.values.get(key)
    if (!existing || existing.expiresAt <= currentTime) {
      this.values.set(key, { count: 1, expiresAt: currentTime + windowMs })
      return 1
    }

    existing.count += 1
    return existing.count
  }
}

class ValkeyRateLimitStore implements RateLimitStore {
  constructor(private readonly url: string) {}

  async increment(key: string, windowMs: number) {
    const count = await sendIntegerCommand(this.url, ['INCR', key])
    if (count === 1) {
      await sendIntegerCommand(this.url, ['PEXPIRE', key, String(windowMs)])
    }
    return count
  }
}

let testStore: RateLimitStore | undefined
let defaultStore: RateLimitStore | undefined

function getStore() {
  if (testStore) return testStore
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return new MemoryRateLimitStore()
  }

  defaultStore ??= new ValkeyRateLimitStore(readServerEnv().VALKEY_URL)
  return defaultStore
}

export function createMemoryRateLimitStore(now?: () => number): RateLimitStore {
  return new MemoryRateLimitStore(now)
}

export function setRateLimitStoreForTests(store: RateLimitStore | undefined) {
  testStore = store
}

export async function checkRateLimit({
  key,
  rule,
  store,
}: {
  key: string
  rule: RateLimitRule
  store?: RateLimitStore
}) {
  const count = await (store ?? getStore()).increment(key, rule.windowMs)
  return { allowed: count <= rule.limit, count, limit: rule.limit }
}

export async function enforceRateLimit(
  key: string,
  rule: RateLimitRule,
  store?: RateLimitStore,
) {
  const result = await checkRateLimit({ key, rule, store })
  if (!result.allowed) {
    logEvent('rate-limit:reject', {
      rateLimitKey: key.split(':').slice(0, 2).join(':'),
      count: result.count,
      limit: result.limit,
    })
    throw new RateLimitError()
  }
}

async function sendIntegerCommand(url: string, args: string[]) {
  const response = await sendValkeyCommands(url, [args])
  const value = response.at(-1)
  if (typeof value !== 'number')
    throw new Error('Invalid Valkey integer response')
  return value
}

export async function checkValkeyConnection(url: string) {
  const response = await sendValkeyCommands(url, [['PING']])
  if (response.at(-1) !== 'PONG') throw new Error('Invalid Valkey ping response')
}

async function sendValkeyCommands(url: string, commands: string[][]) {
  const parsed = new URL(url)
  const authCommand = authArgs(parsed)
  const allCommands = authCommand ? [authCommand, ...commands] : commands
  const socket = await openSocket(parsed)

  try {
    socket.write(allCommands.map(encodeCommand).join(''))
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    while (
      parseResponses(Buffer.concat(chunks).toString('utf8')).length <
      allCommands.length
    ) {
      await once(socket, 'data')
    }
    return parseResponses(Buffer.concat(chunks).toString('utf8'))
  } finally {
    socket.end()
  }
}

async function openSocket(url: URL): Promise<Socket> {
  const port = Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379))
  const host = url.hostname || '127.0.0.1'
  const socket =
    url.protocol === 'rediss:'
      ? connectTls({ host, port, servername: host })
      : createConnection({ host, port })
  await once(socket, url.protocol === 'rediss:' ? 'secureConnect' : 'connect')
  return socket
}

function authArgs(url: URL) {
  const username = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  if (!password) return undefined
  return username ? ['AUTH', username, password] : ['AUTH', password]
}

function encodeCommand(args: string[]) {
  return `*${args.length}\r\n${args
    .map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`)
    .join('')}`
}

function parseResponses(payload: string) {
  const responses: Array<number | string> = []
  let offset = 0
  while (offset < payload.length) {
    const type = payload[offset]
    const end = payload.indexOf('\r\n', offset)
    if (end === -1) break
    const line = payload.slice(offset + 1, end)
    if (type === ':') responses.push(Number(line))
    else if (type === '+') responses.push(line)
    else if (type === '-') throw new Error(`Valkey error: ${line}`)
    else break
    offset = end + 2
  }
  return responses
}
