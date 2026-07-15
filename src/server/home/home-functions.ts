import { createMiddleware, createServerFn } from '@tanstack/react-start'
import type { Pool } from 'pg'
import { canonicalHomeSearch, parseHomeSearch } from '../../features/home/home-search'
import type { HomeSearch } from '../../features/home/home-types'
import { createPoolHomeQueryExecutor, HomeRepository } from './home-repository'
import { homePresence } from './home-presence'

const HOME_RUNTIME_KEY = Symbol.for('bhayanakcast.home-runtime')

interface HomeRuntimeState {
  pool?: Pool
}

function runtimeState(): HomeRuntimeState {
  const shared = globalThis as typeof globalThis & {
    [HOME_RUNTIME_KEY]?: HomeRuntimeState
  }
  return (shared[HOME_RUNTIME_KEY] ??= {})
}

const requestSignal = createMiddleware({ type: 'function' }).server(
  ({ signal, next }) => next({ context: { homeRequestSignal: signal } }),
)

export function bindHomeRuntime(runtime: { pool: Pool | undefined }) {
  runtimeState().pool = runtime.pool
}

export const getHomeRooms = createServerFn({ method: 'GET' })
  .middleware([requestSignal])
  .validator(validateHomeSearch)
  .handler(({ data, context }) =>
    repository().activeRooms(data, context.homeRequestSignal),
  )

export const getHomeProfiles = createServerFn({ method: 'GET' })
  .middleware([requestSignal])
  .validator(validateProfileSearch)
  .handler(({ data, context }) =>
    repository().profiles(data, context.homeRequestSignal),
  )

export const getPastStreams = createServerFn({ method: 'GET' })
  .middleware([requestSignal])
  .handler(({ context }) => repository().pastStreams(context.homeRequestSignal))

export const getHomeFacets = createServerFn({ method: 'GET' })
  .middleware([requestSignal])
  .handler(({ context }) => repository().facets(context.homeRequestSignal))

export const getHomeStatistics = createServerFn({ method: 'GET' })
  .middleware([requestSignal])
  .validator(validateOperatorDay)
  .handler(async ({ data, context }) => {
    const statistics = await repository().statistics(
      data.operatorDay,
      context.homeRequestSignal,
    )
    return {
      ...statistics,
      peakConnectedAccountCount: homePresence.peak(data.operatorDay),
    }
  })

export const getConnectedPresence = createServerFn({ method: 'GET' })
  .middleware([requestSignal])
  .handler(() => ({ connectedAccountCount: homePresence.count() }))

export function validateHomeSearch(value: unknown): HomeSearch {
  return canonicalHomeSearch(parseHomeSearch(value))
}

function validateProfileSearch(value: unknown): HomeSearch {
  return validateHomeSearch(value)
}

function validateOperatorDay(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('operatorDay' in value) ||
    typeof value.operatorDay !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.operatorDay)
  ) {
    throw new TypeError('operatorDay must be an ISO date')
  }
  const [year, month, day] = value.operatorDay.split('-').map(Number)
  const instant = new Date(Date.UTC(year!, month! - 1, day!))
  if (instant.toISOString().slice(0, 10) !== value.operatorDay) {
    throw new TypeError('operatorDay must be a valid ISO date')
  }
  return { operatorDay: value.operatorDay }
}

function repository() {
  const pool = runtimeState().pool
  if (!pool) throw new Error('DATABASE_URL is required for Home discovery')
  return new HomeRepository(createPoolHomeQueryExecutor(pool))
}
