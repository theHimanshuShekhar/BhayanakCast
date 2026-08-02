import { describe, expect, it } from 'vitest'
import {
  evaluateCapacity,
  percentile,
  serverFnId,
  type CapacityMeasurements,
  type Thresholds,
} from '../../scripts/capacity-qualification-lib'

const thresholds: Thresholds = {
  maxAckP95Ms: 500,
  maxAdmissionP95Ms: 2_000,
  maxErrorRate: 0,
  maxProcessCpuPercent: 80,
  maxRssBytes: 512 * 1_024 * 1_024,
  maxEventLoopDelayP99Ms: 100,
  maxPostgresConnections: 20,
  maxPostgresSlowQueries: 0,
  maxPostgresDeadlocks: 0,
  maxPostgresLockWaits: 0,
  maxValkeyUsedMemoryBytes: 128 * 1_024 * 1_024,
  maxValkeyPingP95Ms: 50,
  maxValkeyEvictions: 0,
  maxValkeyConnectionErrors: 0,
  maxRecoveryMs: 5_000,
}

const passing: CapacityMeasurements = {
  durationSeconds: 900,
  roomCount: 25,
  maxObservedRoomMembers: 10,
  minimumPresenceEventsPerSocket: 2,
  minimumChatEventsPerSocket: 1,
  socketConnectCount: 251,
  socketDisconnectCount: 1,
  accountCount: 250,
  fullAdmissionRejections: 25,
  unexpectedAdmissionResults: 0,
  homeAccountEvictions: 0,
  rejectedJoinCount: 0,
  socketErrorCount: 0,
  timedOutAckCount: 0,
  ackLatenciesMs: [10, 20, 30],
  admissionLatenciesMs: [100, 200, 300],
  operationCount: 100,
  errorCount: 0,
  recoveryMs: 100,
  maxProcessCpuPercent: 40,
  maxRssBytes: 256 * 1_024 * 1_024,
  maxPostgresConnections: 10,
  maxEventLoopDelayP99Ms: 50,
  maxPostgresSlowQueries: 0,
  postgresDeadlocks: 0,
  maxPostgresLockWaits: 0,
  maxValkeyUsedMemoryBytes: 64 * 1_024 * 1_024,
  valkeyPingLatenciesMs: [1, 2, 3],
  valkeyEvictions: 0,
  valkeyConnectionErrors: 0,
}
describe('capacity qualification verdict', () => {
  it('passes only when every launch threshold holds', () => {
    expect(evaluateCapacity(passing, thresholds)).toMatchObject({
      verdict: 'pass',
      checks: {
        roomsFull: true,
        accountsConnected: true,
        capacityGateHeld: true,
      },
    })
  })

  it.each(
    [
      ['short run', { durationSeconds: 899 }],
      ['missing room', { roomCount: 24 }],
      ['capacity overflow', { maxObservedRoomMembers: 11 }],
      ['missing presence fanout', { minimumPresenceEventsPerSocket: 1 }],
      ['missing chat fanout', { minimumChatEventsPerSocket: 0 }],
      ['missing account', { accountCount: 249 }],
      ['capacity leak', { fullAdmissionRejections: 24 }],
      ['unexpected admission', { unexpectedAdmissionResults: 1 }],
      ['account eviction', { homeAccountEvictions: 1 }],
      ['rejected channel join', { rejectedJoinCount: 1 }],
      ['socket error', { socketErrorCount: 1 }],
      ['timed-out acknowledgement', { timedOutAckCount: 1 }],
      ['missing reconnect', { socketConnectCount: 250 }],
      ['extra disconnect', { socketDisconnectCount: 2 }],
      ['slow realtime ack', { ackLatenciesMs: [501] }],
      ['slow admission', { admissionLatenciesMs: [2_001] }],
      ['operation error', { errorCount: 1 }],
      ['slow recovery', { recoveryMs: 5_001 }],
      ['high CPU', { maxProcessCpuPercent: 81 }],
      ['high memory', { maxRssBytes: 512 * 1_024 * 1_024 + 1 }],
      ['blocked event loop', { maxEventLoopDelayP99Ms: 101 }],
      ['too many database connections', { maxPostgresConnections: 21 }],
      ['slow database query', { maxPostgresSlowQueries: 1 }],
      ['database deadlock', { postgresDeadlocks: 1 }],
      ['database lock wait', { maxPostgresLockWaits: 1 }],
      ['high Valkey memory', { maxValkeyUsedMemoryBytes: 128 * 1_024 * 1_024 + 1 }],
      ['slow Valkey ping', { valkeyPingLatenciesMs: [51] }],
      ['Valkey eviction', { valkeyEvictions: 1 }],
      ['Valkey connection error', { valkeyConnectionErrors: 1 }],
    ] satisfies Array<[string, Partial<CapacityMeasurements>]>,
  )('fails for a plausible %s regression', (_name, regression) => {
    expect(evaluateCapacity({ ...passing, ...regression }, thresholds).verdict).toBe(
      'fail',
    )
  })

  it('uses the nearest-rank 95th percentile', () => {
    expect(percentile([1, 2, 3, 4, 100], 0.95)).toBe(100)
  })

  it('finds a named RPC id without accepting a neighbouring export', () => {
    const expected = 'a'.repeat(64)
    const other = 'b'.repeat(64)
    const bundle = `const other = handler(createClientRpc)("${other}"));\nconst admitRoom = handler(createClientRpc)("${expected}"));`
    expect(serverFnId(bundle, 'admitRoom')).toBe(expected)
    expect(() => serverFnId(bundle, 'leaveRoom')).toThrow('Missing leaveRoom')
  })
})
