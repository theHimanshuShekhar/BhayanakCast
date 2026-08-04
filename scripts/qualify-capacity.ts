import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { io, type Socket } from 'socket.io-client'
import { fromCrossJSON, toJSONAsync } from 'seroval'
import { HOME_ACCOUNT_REPLACED_EVENT } from '../src/server/realtime/home-events'
import {
  ROOM_CHAT_COMMAND,
  ROOM_JOIN_COMMAND,
  ROOM_LEAVE_COMMAND,
  ROOM_SOCKET_EVENT,
  ROOM_TYPING_COMMAND,
  type RoomRealtimeEvent,
} from '../src/server/realtime/room-events'
import {
  createTestAccountHarness,
  type TestAccountHarness,
} from '../tests/helpers/test-account'
import {
  createTestEnvironment,
  type TestEnvironment,
} from '../tests/helpers/test-environment'
import { startTestServer, type TestServer } from '../tests/helpers/test-server'
import {
  evaluateCapacity,
  percentile,
  readProcessSample,
  serverFnId,
  type CapacityMeasurements,
  type ProcessSample,
  type Thresholds,
} from './capacity-qualification-lib'

const ROOM_COUNT = 25
const ROOM_CAPACITY = 10
const ACCOUNT_COUNT = ROOM_COUNT * ROOM_CAPACITY
const DEFAULT_DURATION_SECONDS = 15 * 60
const CYCLE_MS = 5_000
const HOST_DISCORD_IDS = Array.from(
  { length: ROOM_COUNT },
  (_, roomIndex) =>
    String(7_000_000_000_000_000_000n + BigInt(roomIndex * ROOM_CAPACITY)),
)
const previousAdminDiscordIds = process.env.ADMIN_DISCORD_IDS
const previousTestAdminDiscordIds = process.env.TEST_ADMIN_DISCORD_IDS
const hostDiscordIds = HOST_DISCORD_IDS.join(',')
process.env.ADMIN_DISCORD_IDS = hostDiscordIds
process.env.TEST_ADMIN_DISCORD_IDS = hostDiscordIds
const thresholds: Thresholds = {
  maxAdmissionP95Ms: 2_000,
  maxAckP95Ms: 500,
  maxErrorRate: 0,
  maxPostgresConnections: 20,
  maxPostgresSlowQueries: 0,
  maxPostgresDeadlocks: 0,
  maxPostgresLockWaits: 0,
  maxValkeyUsedMemoryBytes: 128 * 1_024 * 1_024,
  maxValkeyPingP95Ms: 50,
  maxValkeyEvictions: 0,
  maxValkeyConnectionErrors: 0,
  maxProcessCpuPercent: 80,
  maxRssBytes: 512 * 1_024 * 1_024,
  maxEventLoopDelayP99Ms: 100,
  maxRecoveryMs: 5_000,
}

type Rpc = (options: {
  data: unknown
  headers: Headers
}) => Promise<unknown>

type Account = {
  readonly id: string
  readonly cookie: string
}

type RecordedLatency = {
  readonly operation: string
  readonly milliseconds: number
}

interface ResourceSample {
  readonly at: string
  readonly processCpuPercent: number
  readonly rssBytes: number
  readonly eventLoopDelayP99Ms: number
  readonly eventLoopDelayMaxMs: number
  readonly postgresConnections: number
  readonly postgresActiveConnections: number
  readonly postgresSlowQueries: number
  readonly postgresLockWaits: number
  readonly postgresDeadlocks: number
  readonly valkeyUsedMemoryBytes: number
  readonly valkeyPingMs: number
  readonly valkeyEvictions: number
}

const options = parseOptions(process.argv.slice(2))
const startedAt = wallTimestamp()
let payloadSequence = 0
const environment = await createTestEnvironment(`capacity-${process.pid}`)
let server: TestServer | undefined
let accounts: TestAccountHarness | undefined
let redis: Redis | undefined
const sockets: Socket[] = []
const roomSockets = Array.from({ length: ROOM_COUNT }, () => [] as Socket[])
const roomAccounts = Array.from({ length: ROOM_COUNT }, () => [] as Account[])
const latencies: RecordedLatency[] = []
const errors: string[] = []
const resourceSamples: ResourceSample[] = []
const presenceEventsBySocket = new Map<Socket, number>()
const chatEventsBySocket = new Map<Socket, number>()
const ackOutcomes: Record<string, number> = {}
const rpcOutcomes: Record<string, number> = {}
let operationCount = 0
let errorCount = 0
let homeAccountEvictions = 0
let fullAdmissionRejections = 0
let unexpectedAdmissionResults = 0
let rejectedJoinCount = 0
let socketErrorCount = 0
let socketConnectCount = 0
let socketDisconnectCount = 0
let timedOutAckCount = 0
let valkeyConnectionErrors = 0
let recoveryMs = Number.POSITIVE_INFINITY

try {
  server = await startTestServer(environment)
  accounts = await createTestAccountHarness({
    workerId: environment.workerId,
    environment,
    server,
  })
  redis = new Redis(environment.valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  redis.on('error', () => {
    valkeyConnectionErrors += 1
  })
  await redis.connect()
  const infrastructureBaseline = await readInfrastructureCounters(
    environment,
    redis,
  )

  const bundle = await readFile('dist/client/assets/js/index.js', 'utf8')
  const createRoom = rpcClient(server.origin, serverFnId(bundle, 'createRoom'))
  const admitRoom = rpcClient(server.origin, serverFnId(bundle, 'admitRoom'))
  const leaveRoom = rpcClient(server.origin, serverFnId(bundle, 'leaveRoom'))
  const endAdminRoom = rpcClient(
    server.origin,
    serverFnId(bundle, 'endAdminRoom'),
    false,
  )

  const signedIn = await mapConcurrent(
    Array.from({ length: ACCOUNT_COUNT + ROOM_COUNT }, (_, index) => index),
    20,
    async (index): Promise<Account> => {
      const auth = await accounts!.signInDiscord({
        id: String(7_000_000_000_000_000_000n + BigInt(index)),
        username: `capacity-${index}`,
        global_name: `Capacity ${index}`,
        avatar: null,
        email: `capacity-${index}@example.test`,
        verified: true,
      })
      const session = await accounts!.readProjectedSession(auth.sessionCookie)
      if (!session) throw new Error(`Capacity Account ${index} has no session`)
      return {
        id: session.id,
        cookie: auth.sessionCookie,
      }
    },
  )

  const rooms = await Promise.all(
    Array.from({ length: ROOM_COUNT }, async (_, roomIndex) => {
      const result = await recordRpc(
        'create-room',
        () =>
          createRoom({
            data: {
              input: {
                name: `Capacity Room ${roomIndex + 1}`,
                visibility: 'public',
              },
            },
            headers: cookieHeaders(signedIn[roomIndex * ROOM_CAPACITY]),
          }),
        latencies,
      ) as { status?: string; room?: { id?: string } }
      if (result.status !== 'created' || !result.room?.id) {
        throw new Error(
          `Room ${roomIndex + 1} creation returned ${JSON.stringify(result)}`,
        )
      }
      return result.room.id
    }),
  )

  for (let roomIndex = 0; roomIndex < ROOM_COUNT; roomIndex += 1) {
    const host = signedIn[roomIndex * ROOM_CAPACITY]
    roomAccounts[roomIndex].push(host)
    const socket = connectSocket(server.origin, host)
    sockets.push(socket)
    roomSockets[roomIndex].push(socket)
    await waitForConnection(socket)
    await expectAck(socket, ROOM_JOIN_COMMAND, rooms[roomIndex], 'joined', 'host-join')
  }

  const admissionTasks: Promise<void>[] = []
  for (let roomIndex = 0; roomIndex < ROOM_COUNT; roomIndex += 1) {
    const candidates = [
      ...Array.from(
        { length: ROOM_CAPACITY - 1 },
        (_, slot) => signedIn[roomIndex * ROOM_CAPACITY + slot + 1],
      ),
      signedIn[ACCOUNT_COUNT + roomIndex],
    ]
    for (const candidate of candidates) {
      admissionTasks.push(
        (async () => {
          const result = await recordRpc(
            'admit-room',
            () =>
              admitRoom({
                data: { roomId: rooms[roomIndex] },
                headers: cookieHeaders(candidate),
              }),
            latencies,
          ) as { status?: string }
          if (result.status === 'joined') {
            roomAccounts[roomIndex].push(candidate)
          } else if (result.status === 'full') {
            fullAdmissionRejections += 1
          } else {
            unexpectedAdmissionResults += 1
            errorCount += 1
            errors.push(
              `Expected joined or full for room ${roomIndex}, got ${result.status}`,
            )
          }
        })(),
      )
    }
  }
  await Promise.all(admissionTasks)

  for (let roomIndex = 0; roomIndex < ROOM_COUNT; roomIndex += 1) {
    if (roomAccounts[roomIndex].length !== ROOM_CAPACITY) {
      throw new Error(
        `Room ${roomIndex} admitted ${roomAccounts[roomIndex].length} Accounts`,
      )
    }
    for (const account of roomAccounts[roomIndex].slice(1)) {
      const socket = connectSocket(server.origin, account)
      sockets.push(socket)
      roomSockets[roomIndex].push(socket)
      await waitForConnection(socket)
      await expectAck(
        socket,
        ROOM_JOIN_COMMAND,
        rooms[roomIndex],
        'joined',
        'member-join',
      )
    }
  }

  const initialCounts = await readRoomCounts(environment)
  if (initialCounts.length !== ROOM_COUNT || initialCounts.some((room) => room.count !== 10)) {
    throw new Error(`Expected 25 full rooms, got ${JSON.stringify(initialCounts)}`)
  }

  const churnMembershipIds = await Promise.all(
    rooms.map((roomId, roomIndex) =>
      readActiveMembershipId(
        environment,
        roomId,
        roomAccounts[roomIndex][ROOM_CAPACITY - 1].id,
      ),
    ),
  )
  await Promise.all(
    rooms.map(async (roomId, roomIndex) => {
      const account = roomAccounts[roomIndex][ROOM_CAPACITY - 1]
      const result = (await recordRpc(
        'leave-room',
        () =>
          leaveRoom({
            data: { roomId, membershipId: churnMembershipIds[roomIndex] },
            headers: cookieHeaders(account),
          }),
        latencies,
      )) as { status?: string }
      if (result.status !== 'left') {
        throw new Error(`Membership leave returned ${result.status}`)
      }
    }),
  )
  await Promise.all(
    rooms.map(async (roomId, roomIndex) => {
      const account = roomAccounts[roomIndex][ROOM_CAPACITY - 1]
      const result = (await recordRpc(
        'readmit-room',
        () =>
          admitRoom({
            data: { roomId },
            headers: cookieHeaders(account),
          }),
        latencies,
      )) as { status?: string }
      if (result.status !== 'joined') {
        throw new Error(`Membership readmission returned ${result.status}`)
      }
    }),
  )
  await waitForCondition(
    () => minimumSocketCount(presenceEventsBySocket, sockets) >= 2,
    'presence fanout',
  )

  for (const socket of sockets) {
    await expectAck(socket, ROOM_LEAVE_COMMAND, null, 'left', 'channel-leave')
  }
  for (let roomIndex = 0; roomIndex < ROOM_COUNT; roomIndex += 1) {
    for (const socket of roomSockets[roomIndex]) {
      await expectAck(
        socket,
        ROOM_JOIN_COMMAND,
        rooms[roomIndex],
        'joined',
        'channel-rejoin',
      )
    }
  }

  const displaced = roomSockets[0][1]
  const recoveryStarted = performance.now()
  displaced.disconnect()
  const recovered = connectSocket(server.origin, roomAccounts[0][1])
  roomSockets[0][1] = recovered
  sockets[sockets.indexOf(displaced)] = recovered
  await waitForConnection(recovered)
  await expectAck(recovered, ROOM_JOIN_COMMAND, rooms[0], 'joined', 'reconnect')
  recoveryMs = performance.now() - recoveryStarted
  const postRecoveryMember = roomAccounts[0][ROOM_CAPACITY - 1]
  const postRecoveryMembershipId = await readActiveMembershipId(
    environment,
    rooms[0],
    postRecoveryMember.id,
  )
  const postRecoveryLeave = (await recordRpc(
    'leave-room',
    () =>
      leaveRoom({
        data: {
          roomId: rooms[0],
          membershipId: postRecoveryMembershipId,
        },
        headers: cookieHeaders(postRecoveryMember),
      }),
    latencies,
  )) as { status?: string }
  if (postRecoveryLeave.status !== 'left') {
    throw new Error(`Post-recovery leave returned ${postRecoveryLeave.status}`)
  }
  const postRecoveryReadmission = (await recordRpc(
    'readmit-room',
    () =>
      admitRoom({
        data: { roomId: rooms[0] },
        headers: cookieHeaders(postRecoveryMember),
      }),
    latencies,
  )) as { status?: string }
  if (postRecoveryReadmission.status !== 'joined') {
    throw new Error(
      `Post-recovery readmission returned ${postRecoveryReadmission.status}`,
    )
  }
  await waitForCondition(
    () => minimumSocketCount(presenceEventsBySocket, sockets) >= 2,
    'post-recovery presence fanout',
  )

  await server.metrics()
  const sustainStarted = performance.now()
  const runUntil = sustainStarted + options.durationSeconds * 1_000
  let previousProcessSample: ProcessSample | undefined
  let serverClockMs = environment.clock.now()
  while (performance.now() < runUntil) {
    const cycleStarted = performance.now()
    serverClockMs += CYCLE_MS
    await server.advanceClock(serverClockMs)
    await Promise.all(
      rooms.flatMap((_roomId, roomIndex) => [
        expectAck(
          roomSockets[roomIndex][0],
          ROOM_CHAT_COMMAND,
          {
            body: `capacity-${nextDeterministicUuid()}`,
            mutationId: nextDeterministicUuid(),
          },
          'sent',
          'chat',
        ),
        expectAck(
          roomSockets[roomIndex][1],
          ROOM_TYPING_COMMAND,
          true,
          'accepted',
          'typing-on',
        ),
        expectAck(
          roomSockets[roomIndex][1],
          ROOM_TYPING_COMMAND,
          false,
          'accepted',
          'typing-off',
        ),
      ]),
    )
    previousProcessSample = await sampleResources(
      server,
      environment,
      redis,
      previousProcessSample,
      resourceSamples,
    )
    const remaining = Math.min(
      CYCLE_MS - (performance.now() - cycleStarted),
      runUntil - performance.now(),
    )
    if (remaining > 0) await delay(remaining)
  }

  await waitForCondition(
    () => minimumSocketCount(chatEventsBySocket, sockets) >= 1,
    'chat fanout',
  )
  const finalCounts = await readRoomCounts(environment)
  const valkeyKeys = await countKeys(redis, `${environment.valkeyPrefix}*`)
  const postgresBytes = await readSchemaBytes(environment)
  await Promise.all(
    rooms.map(async (roomId, roomIndex) => {
      await recordRpc(
        'admin-end-room',
        () =>
          endAdminRoom({
            data: roomId,
            headers: cookieHeaders(roomAccounts[roomIndex][0]),
          }),
        latencies,
      )
    }),
  )
  const endedRooms = await environment.sql<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM room
      WHERE ended_at IS NOT NULL`,
  )
  if (endedRooms.rows[0]?.count !== ROOM_COUNT) {
    throw new Error(`Admin paths ended ${endedRooms.rows[0]?.count ?? 0} Rooms`)
  }
  const measurements: CapacityMeasurements = {
    durationSeconds: (performance.now() - sustainStarted) / 1_000,
    roomCount: finalCounts.filter((room) => room.count === ROOM_CAPACITY).length,
    maxObservedRoomMembers: Math.max(
      ...initialCounts.map((room) => room.count),
      ...finalCounts.map((room) => room.count),
    ),
    minimumPresenceEventsPerSocket: minimumSocketCount(
      presenceEventsBySocket,
      sockets,
    ),
    minimumChatEventsPerSocket: minimumSocketCount(chatEventsBySocket, sockets),
    accountCount: sockets.filter((socket) => socket.connected).length,
    fullAdmissionRejections,
    unexpectedAdmissionResults,
    homeAccountEvictions,
    rejectedJoinCount,
    socketErrorCount,
    timedOutAckCount,
    socketConnectCount,
    socketDisconnectCount,
    ackLatenciesMs: latencies
      .filter(
        (entry) =>
          entry.operation !== 'create-room' &&
          entry.operation !== 'admit-room' &&
          entry.operation !== 'readmit-room' &&
          entry.operation !== 'leave-room' &&
          entry.operation !== 'admin-end-room',
      )
      .map((entry) => entry.milliseconds),
    admissionLatenciesMs: latencies
      .filter(
        (entry) =>
          entry.operation === 'admit-room' ||
          entry.operation === 'readmit-room',
      )
      .map((entry) => entry.milliseconds),
    operationCount,
    errorCount,
    recoveryMs,
    maxProcessCpuPercent: maximum(resourceSamples, 'processCpuPercent'),
    maxRssBytes: maximum(resourceSamples, 'rssBytes'),
    maxEventLoopDelayP99Ms: maximum(resourceSamples, 'eventLoopDelayP99Ms'),
    maxPostgresConnections: maximum(resourceSamples, 'postgresConnections'),
    maxPostgresSlowQueries: maximum(resourceSamples, 'postgresSlowQueries'),
    postgresDeadlocks: Math.max(
      0,
      maximum(resourceSamples, 'postgresDeadlocks') -
        infrastructureBaseline.postgresDeadlocks,
    ),
    maxPostgresLockWaits: maximum(resourceSamples, 'postgresLockWaits'),
    maxValkeyUsedMemoryBytes: maximum(resourceSamples, 'valkeyUsedMemoryBytes'),
    valkeyPingLatenciesMs: resourceSamples.map((sample) => sample.valkeyPingMs),
    valkeyEvictions: Math.max(
      0,
      maximum(resourceSamples, 'valkeyEvictions') -
        infrastructureBaseline.valkeyEvictions,
    ),
    valkeyConnectionErrors,
  }
  const result = evaluateCapacity(measurements, thresholds)
  const evidence = {
    schemaVersion: 2,
    startedAt,
    completedAt: wallTimestamp(),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: cpus().length,
    },
    configuration: {
      durationSeconds: options.durationSeconds,
      roomCount: ROOM_COUNT,
      roomCapacity: ROOM_CAPACITY,
      accountCount: ACCOUNT_COUNT,
      seed: options.seed,
      cycleMilliseconds: CYCLE_MS,
      thresholds,
    },
    measurements: {
      ...measurements,
      ackLatenciesMs: undefined,
      admissionLatenciesMs: undefined,
      valkeyPingLatenciesMs: undefined,
      socketConnectCount,
      socketDisconnectCount,
      ackOutcomes,
      rpcOutcomes,
      postgresSchemaBytes: postgresBytes,
      valkeyKeyCount: valkeyKeys,
      latency: latencySummary(latencies),
      resourceSamples,
      errors,
    },
    result,
  }
  await preserveExistingEvidence(options.output)
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(
    JSON.stringify({
      output: options.output,
      verdict: result.verdict,
      checks: result.checks,
    }),
  )
  if (result.verdict !== 'pass') process.exitCode = 1

  async function expectAck(
    socket: Socket,
    event: string,
    payload: unknown,
    expectedStatus: string,
    operation: string,
  ) {
    operationCount += 1
    const before = performance.now()
    try {
      const response = (await socket.timeout(5_000).emitWithAck(event, payload)) as {
        status?: string
      }
      const outcome = `${operation}:${response.status ?? 'missing-status'}`
      ackOutcomes[outcome] = (ackOutcomes[outcome] ?? 0) + 1
      if (event === ROOM_JOIN_COMMAND && response.status === 'rejected') {
        rejectedJoinCount += 1
      }
      latencies.push({ operation, milliseconds: performance.now() - before })
      if (response.status !== expectedStatus) {
        throw new Error(`${operation} returned ${response.status}; expected ${expectedStatus}`)
      }
    } catch (error) {
      errorCount += 1
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('timed out')) timedOutAckCount += 1
      if (errors.length < 50) errors.push(message)
      throw error
    }
  }
} catch (error) {
  errorCount += 1
  const message = error instanceof Error ? error.message : String(error)
  if (errors.length < 50) errors.push(message)
  const evidence = {
    schemaVersion: 2,
    startedAt,
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: cpus().length,
    },
    completedAt: wallTimestamp(),
    configuration: {
      durationSeconds: options.durationSeconds,
      roomCount: ROOM_COUNT,
      roomCapacity: ROOM_CAPACITY,
      accountCount: ACCOUNT_COUNT,
      cycleMilliseconds: CYCLE_MS,
      seed: options.seed,
      thresholds,
    },
    measurements: null,
    failure: {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    },
    partial: {
      operationCount,
      errorCount,
      socketConnectCount,
      socketDisconnectCount,
      socketErrorCount,
      timedOutAckCount,
      rejectedJoinCount,
      fullAdmissionRejections,
      unexpectedAdmissionResults,
      homeAccountEvictions,
      valkeyConnectionErrors,
      ackOutcomes,
      rpcOutcomes,
      latency: latencySummary(latencies),
      resourceSamples,
      errors,
    },
    result: { verdict: 'fail', checks: null, derived: null },
  }
  await preserveExistingEvidence(options.output)
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, `${JSON.stringify(evidence, null, 2)}\n`)
  console.error(
    JSON.stringify({ output: options.output, verdict: 'fail', failure: message }),
  )
  process.exitCode = 1
} finally {
  for (const socket of sockets) socket?.disconnect()
  await Promise.allSettled([
    redis ? redis.quit() : Promise.resolve(),
    accounts ? accounts.cleanup() : Promise.resolve(),
  ])
  await Promise.allSettled([
    server ? server.stop() : Promise.resolve(),
    environment.cleanup(),
  ])
  if (previousAdminDiscordIds === undefined) delete process.env.ADMIN_DISCORD_IDS
  else process.env.ADMIN_DISCORD_IDS = previousAdminDiscordIds
  if (previousTestAdminDiscordIds === undefined) {
    delete process.env.TEST_ADMIN_DISCORD_IDS
  } else {
    process.env.TEST_ADMIN_DISCORD_IDS = previousTestAdminDiscordIds
  }
}

async function preserveExistingEvidence(output: string) {
  let timestamp = startedAt
  try {
    const existing = JSON.parse(await readFile(output, 'utf8')) as {
      startedAt?: unknown
    }
    if (typeof existing.startedAt === 'string') timestamp = existing.startedAt
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) return
    if (!(error instanceof SyntaxError)) throw error
  }
  const suffix = timestamp.replace(/[:.]/g, '-')
  const archive = output.endsWith('.json')
    ? `${output.slice(0, -5)}-${suffix}.json`
    : `${output}-${suffix}`
  await copyFile(output, archive)
}

function parseOptions(arguments_: readonly string[]) {
  let durationSeconds = DEFAULT_DURATION_SECONDS
  let output = resolve('ops/evidence/capacity-qualification.json')
  let seed = randomUUID()
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] === '--') continue
    if (arguments_[index] === '--duration-seconds') {
      durationSeconds = Number(arguments_[++index])
    } else if (arguments_[index] === '--output') {
      output = resolve(arguments_[++index])
    } else if (arguments_[index] === '--seed') {
      seed = arguments_[++index]
    } else {
      throw new Error(`Unknown capacity qualification option: ${arguments_[index]}`)
    }
  }
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1) {
    throw new Error('--duration-seconds must be a positive integer')
  }
  if (!seed) throw new Error('--seed must not be empty')
  return { durationSeconds, output, seed }
}

function cookieHeaders(account: Account) {
  return new Headers({
    cookie: account.cookie,
    origin: server?.origin ?? '',
  })
}

function connectSocket(origin: string, account: Account) {
  const socket = io(origin, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: {
      cookie: account.cookie,
      origin,
    },
  })
  presenceEventsBySocket.set(socket, 0)
  chatEventsBySocket.set(socket, 0)
  socket.on('connect', () => {
    socketConnectCount += 1
  })
  socket.on('disconnect', () => {
    socketDisconnectCount += 1
  })
  socket.on('connect_error', (error) => {
    socketErrorCount += 1
    if (errors.length < 50) errors.push(error.message)
  })
  socket.on('error', (error) => {
    socketErrorCount += 1
    if (errors.length < 50) errors.push(String(error))
  })
  socket.on(HOME_ACCOUNT_REPLACED_EVENT, () => {
    homeAccountEvictions += 1
  })
  socket.on(ROOM_SOCKET_EVENT, (event: RoomRealtimeEvent) => {
    if (event.type === 'membership-changed') {
      presenceEventsBySocket.set(
        socket,
        (presenceEventsBySocket.get(socket) ?? 0) + 1,
      )
    } else if (event.type === 'chat-message') {
      chatEventsBySocket.set(socket, (chatEventsBySocket.get(socket) ?? 0) + 1)
    }
  })
  return socket
}

function waitForConnection(socket: Socket) {
  if (socket.connected) return Promise.resolve()
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 5_000)
  socket.once('connect', () => {
    clearTimeout(timeout)
    resolve()
  })
  socket.once('connect_error', (error) => {
    clearTimeout(timeout)
    reject(error)
  })
  return promise
}

async function recordRpc(
  operation: string,
  run: () => Promise<unknown>,
  latencies: RecordedLatency[],
) {
  operationCount += 1
  const before = performance.now()
  try {
    const result = await run()
    latencies.push({ operation, milliseconds: performance.now() - before })
    const status =
      result && typeof result === 'object' && 'status' in result
        ? String(result.status)
        : 'succeeded'
    const outcome = `${operation}:${status}`
    rpcOutcomes[outcome] = (rpcOutcomes[outcome] ?? 0) + 1
    return result
  } catch (error) {
    errorCount += 1
    const outcome = `${operation}:failed`
    rpcOutcomes[outcome] = (rpcOutcomes[outcome] ?? 0) + 1
    if (errors.length < 50) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
    throw error
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < values.length) {
        const index = next
        next += 1
        results[index] = await map(values[index])
      }
    }),
  )
  return results
}

async function readRoomCounts(environment: TestEnvironment) {
  const result = await environment.sql<{ roomId: string; count: number }>(
    `SELECT room_id AS "roomId", count(*)::int AS count
       FROM room_membership
      WHERE left_at IS NULL
      GROUP BY room_id
      ORDER BY room_id`,
  )
  return result.rows
}
async function readActiveMembershipId(
  environment: TestEnvironment,
  roomId: string,
  accountId: string,
) {
  const result = await environment.sql<{ id: string }>(
    `SELECT id
       FROM room_membership
      WHERE room_id = $1
        AND account_id = $2
        AND left_at IS NULL`,
    [roomId, accountId],
  )
  const id = result.rows[0]?.id
  if (!id) throw new Error(`Missing active membership for Account ${accountId}`)
  return id
}


async function readSchemaBytes(environment: TestEnvironment) {
  const result = await environment.sql<{ bytes: string }>(
    `SELECT coalesce(sum(pg_total_relation_size(c.oid)), 0)::text AS bytes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'm')`,
    [environment.schema],
  )
  return Number(result.rows[0]?.bytes ?? 0)
}

async function sampleResources(
  server: TestServer,
  environment: TestEnvironment,
  redis: Redis,
  previous: ProcessSample | undefined,
  samples: ResourceSample[],
) {
  const ping = async () => {
    const started = performance.now()
    await redis.ping()
    return performance.now() - started
  }
  const [
    processSample,
    postgres,
    memoryInfo,
    valkeyStats,
    serverMetrics,
    valkeyPingMs,
  ] =
    await Promise.all([
      readProcessSample(server.pid, previous),
      environment.sql<{
        total: number
        active: number
        slow: number
        lockWaits: number
        deadlocks: string
      }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE state = 'active')::int AS active,
                count(*) FILTER (
                  WHERE state = 'active'
                    AND clock_timestamp() - query_start > interval '500 milliseconds'
                    AND query NOT LIKE '%pg_stat_activity%'
                )::int AS slow,
                count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS "lockWaits",
                (SELECT deadlocks::text
                   FROM pg_stat_database
                  WHERE datname = current_database()) AS deadlocks
           FROM pg_stat_activity
          WHERE application_name = $1`,
        [environment.workerId],
      ),
      redis.info('memory'),
      redis.info('stats'),
      server.metrics(),
      ping(),
    ])
  const usedMemory = Number(memoryInfo.match(/^used_memory:(\d+)$/m)?.[1] ?? 0)
  const valkeyEvictions = Number(
    valkeyStats.match(/^evicted_keys:(\d+)$/m)?.[1] ?? 0,
  )
  samples.push({
    at: wallTimestamp(),
    processCpuPercent: processSample.cpuPercent,
    rssBytes: processSample.rssBytes,
    eventLoopDelayP99Ms: serverMetrics.eventLoopDelayP99Ms,
    eventLoopDelayMaxMs: serverMetrics.eventLoopDelayMaxMs,
    postgresConnections: postgres.rows[0]?.total ?? 0,
    postgresActiveConnections: postgres.rows[0]?.active ?? 0,
    postgresSlowQueries: postgres.rows[0]?.slow ?? 0,
    postgresLockWaits: postgres.rows[0]?.lockWaits ?? 0,
    postgresDeadlocks: Number(postgres.rows[0]?.deadlocks ?? 0),
    valkeyUsedMemoryBytes: usedMemory,
    valkeyPingMs,
    valkeyEvictions,
  })
  return processSample
}

async function countKeys(redis: Redis, pattern: string) {
  let cursor = '0'
  let count = 0
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1_000)
    cursor = next
    count += keys.length
  } while (cursor !== '0')
  return count
}

async function readInfrastructureCounters(
  environment: TestEnvironment,
  redis: Redis,
) {
  const [postgres, valkeyStats] = await Promise.all([
    environment.sql<{ deadlocks: string }>(
      `SELECT deadlocks::text
         FROM pg_stat_database
        WHERE datname = current_database()`,
    ),
    redis.info('stats'),
  ])
  return {
    postgresDeadlocks: Number(postgres.rows[0]?.deadlocks ?? 0),
    valkeyEvictions: Number(
      valkeyStats.match(/^evicted_keys:(\d+)$/m)?.[1] ?? 0,
    ),
  }
}

type NumericResourceKey = Exclude<keyof ResourceSample, 'at'>

function maximum(
  samples: readonly ResourceSample[],
  key: NumericResourceKey,
) {
  return Math.max(0, ...samples.map((sample) => sample[key]))
}

function minimumSocketCount(
  counts: ReadonlyMap<Socket, number>,
  activeSockets: readonly Socket[],
) {
  return Math.min(...activeSockets.map((socket) => counts.get(socket) ?? 0))
}

async function waitForCondition(
  condition: () => boolean,
  description: string,
  timeoutMs = 5_000,
) {
  const deadline = performance.now() + timeoutMs
  while (!condition()) {
    if (performance.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`)
    }
    await delay(25)
  }
}

function latencySummary(latencies: readonly RecordedLatency[]) {
  return Object.fromEntries(
    [...new Set(latencies.map((entry) => entry.operation))].map((operation) => {
      const values = latencies
        .filter((entry) => entry.operation === operation)
        .map((entry) => entry.milliseconds)
      return [
        operation,
        {
          count: values.length,
          p50Ms: percentile(values, 0.5),
          p95Ms: percentile(values, 0.95),
          p99Ms: percentile(values, 0.99),
          maxMs: Math.max(...values),
        },
      ]
    }),
  )
}

function nextDeterministicUuid() {
  const digest = createHash('sha256')
    .update(`${options.seed}:${payloadSequence++}`)
    .digest('hex')
  const hexadecimal = `${digest.slice(0, 12)}4${digest.slice(13, 16)}8${digest.slice(17, 32)}`
  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20),
  ].join('-')
}

function delay(milliseconds: number) {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, milliseconds)
  return promise
}

function rpcClient(origin: string, id: string, decode = true): Rpc {
  return async ({ data, headers }) => {
    const requestHeaders = new Headers(headers)
    requestHeaders.set('accept', 'application/json')
    requestHeaders.set('content-type', 'application/json')
    requestHeaders.set('x-tsr-serverFn', 'true')
    const body = JSON.stringify(await toJSONAsync({ data }))
    const response = await fetch(`${origin}/_serverFn/${id}`, {
      method: 'POST',
      headers: requestHeaders,
      body,
    })
    if (!response.ok) {
      throw new Error(`Server function failed (${response.status}): ${await response.text()}`)
    }
    if (!decode) {
      await response.body?.cancel()
      return { status: 'http-accepted' }
    }
    const payload = await response.json()
    const decoded =
      response.headers.get('x-tss-serialized') === 'true'
        ? fromCrossJSON(payload, { plugins: [] })
        : payload
    return unwrapServerFnResult(decoded)
  }
}

function unwrapServerFnResult(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'result' in value
  ) {
    return value.result
  }
  return value
}

function wallTimestampMs() {
  return Math.floor(performance.timeOrigin + performance.now())
}

function wallTimestamp() {
  return new Date(performance.timeOrigin + performance.now()).toISOString()
}
