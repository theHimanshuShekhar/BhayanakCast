import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'

export interface Thresholds {
  readonly maxAckP95Ms: number
  readonly maxAdmissionP95Ms: number
  readonly maxErrorRate: number
  readonly maxProcessCpuPercent: number
  readonly maxRssBytes: number
  readonly maxRecoveryMs: number
  readonly maxEventLoopDelayP99Ms: number
  readonly maxPostgresConnections: number
  readonly maxPostgresSlowQueries: number
  readonly maxPostgresDeadlocks: number
  readonly maxPostgresLockWaits: number
  readonly maxValkeyUsedMemoryBytes: number
  readonly maxValkeyPingP95Ms: number
  readonly maxValkeyEvictions: number
  readonly maxValkeyConnectionErrors: number
}

export interface CapacityMeasurements {
  readonly durationSeconds: number
  readonly roomCount: number
  readonly maxObservedRoomMembers: number
  readonly minimumPresenceEventsPerSocket: number
  readonly minimumChatEventsPerSocket: number
  readonly socketConnectCount: number
  readonly socketDisconnectCount: number
  readonly accountCount: number
  readonly fullAdmissionRejections: number
  readonly unexpectedAdmissionResults: number
  readonly homeAccountEvictions: number
  readonly rejectedJoinCount: number
  readonly socketErrorCount: number
  readonly timedOutAckCount: number
  readonly ackLatenciesMs: readonly number[]
  readonly admissionLatenciesMs: readonly number[]
  readonly operationCount: number
  readonly errorCount: number
  readonly recoveryMs: number
  readonly maxProcessCpuPercent: number
  readonly maxRssBytes: number
  readonly maxEventLoopDelayP99Ms: number
  readonly maxPostgresConnections: number
  readonly maxPostgresSlowQueries: number
  readonly postgresDeadlocks: number
  readonly maxPostgresLockWaits: number
  readonly maxValkeyUsedMemoryBytes: number
  readonly valkeyPingLatenciesMs: readonly number[]
  readonly valkeyEvictions: number
  readonly valkeyConnectionErrors: number
}

export interface ProcessSample {
  readonly at: number
  readonly ticks: number
  readonly systemTicks: number
  readonly cpuPercent: number
  readonly rssBytes: number
}

export function serverFnId(bundle: string, exportName: string): string {
  const marker = `const ${exportName} =`
  const start = bundle.indexOf(marker)
  if (start < 0) throw new Error(`Missing ${exportName} in the client bundle`)
  const match = bundle
    .slice(start, start + 1_000)
    .match(/createClientRpc\)\("([0-9a-f]{64})"\)/)
  if (!match) throw new Error(`Missing RPC id for ${exportName}`)
  return match[1]
}

export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(quantile * sorted.length) - 1]
}

export function evaluateCapacity(
  measurement: CapacityMeasurements,
  thresholds: Thresholds,
) {
  const ackP95Ms = percentile(measurement.ackLatenciesMs, 0.95)
  const admissionP95Ms = percentile(measurement.admissionLatenciesMs, 0.95)
  const valkeyPingP95Ms = percentile(measurement.valkeyPingLatenciesMs, 0.95)
  const errorRate =
    measurement.operationCount === 0
      ? 1
      : measurement.errorCount / measurement.operationCount
  const checks = {
    duration: measurement.durationSeconds >= 15 * 60,
    roomsFull: measurement.roomCount === 25,
    roomCapacity: measurement.maxObservedRoomMembers <= 10,
    presenceFanout: measurement.minimumPresenceEventsPerSocket >= 2,
    chatFanout: measurement.minimumChatEventsPerSocket >= 1,
    accountsConnected: measurement.accountCount === 250,
    capacityGateHeld:
      measurement.fullAdmissionRejections === 25 &&
      measurement.unexpectedAdmissionResults === 0,
    noAccountEvictions: measurement.homeAccountEvictions === 0,
    noRejectedJoins: measurement.rejectedJoinCount === 0,
    noSocketErrors: measurement.socketErrorCount === 0,
    noTimedOutAcks: measurement.timedOutAckCount === 0,
    ackLatency: ackP95Ms <= thresholds.maxAckP95Ms,
    reconnectLifecycle:
      measurement.socketConnectCount === 251 &&
      measurement.socketDisconnectCount === 1,
    admissionLatency: admissionP95Ms <= thresholds.maxAdmissionP95Ms,
    errorRate: errorRate <= thresholds.maxErrorRate,
    recovery: measurement.recoveryMs <= thresholds.maxRecoveryMs,
    cpu: measurement.maxProcessCpuPercent <= thresholds.maxProcessCpuPercent,
    memory: measurement.maxRssBytes <= thresholds.maxRssBytes,
    eventLoop:
      measurement.maxEventLoopDelayP99Ms <= thresholds.maxEventLoopDelayP99Ms,
    postgresConnections:
      measurement.maxPostgresConnections <= thresholds.maxPostgresConnections,
    postgresSlowQueries:
      measurement.maxPostgresSlowQueries <= thresholds.maxPostgresSlowQueries,
    postgresDeadlocks:
      measurement.postgresDeadlocks <= thresholds.maxPostgresDeadlocks,
    postgresLockWaits:
      measurement.maxPostgresLockWaits <= thresholds.maxPostgresLockWaits,
    valkeyMemory:
      measurement.maxValkeyUsedMemoryBytes <= thresholds.maxValkeyUsedMemoryBytes,
    valkeyLatency: valkeyPingP95Ms <= thresholds.maxValkeyPingP95Ms,
    valkeyEvictions: measurement.valkeyEvictions <= thresholds.maxValkeyEvictions,
    valkeyConnections:
      measurement.valkeyConnectionErrors <= thresholds.maxValkeyConnectionErrors,
  }
  return {
    verdict: Object.values(checks).every(Boolean) ? ('pass' as const) : ('fail' as const),
    checks,
    derived: { ackP95Ms, admissionP95Ms, valkeyPingP95Ms, errorRate },
  }
}

export async function readProcessSample(
  pid: number,
  previous?: Pick<ProcessSample, 'at' | 'ticks' | 'systemTicks'>,
): Promise<ProcessSample> {
  const [stat, status, systemStat] = await Promise.all([
    readFile(`/proc/${pid}/stat`, 'utf8'),
    readFile(`/proc/${pid}/status`, 'utf8'),
    readFile('/proc/stat', 'utf8'),
  ])
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  const ticks = Number(fields[11]) + Number(fields[12])
  const systemTicks = systemStat
    .slice(0, systemStat.indexOf('\n'))
    .trim()
    .split(/\s+/)
    .slice(1)
    .reduce((total, value) => total + Number(value), 0)
  const rssMatch = status.match(/^VmRSS:\s+(\d+) kB$/m)
  if (!rssMatch) throw new Error(`Missing VmRSS for process ${pid}`)
  const at = performance.now()
  const cpuPercent = previous
    ? ((ticks - previous.ticks) / (systemTicks - previous.systemTicks)) *
      availableParallelism() *
      100
    : 0
  return {
    at,
    ticks,
    systemTicks,
    cpuPercent,
    rssBytes: Number(rssMatch[1]) * 1_024,
  }
}
