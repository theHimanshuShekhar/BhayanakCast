import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import {
  getConnectedPresence,
  getHomeFacets,
  getHomeProfiles,
  getHomeRooms,
  getHomeStatistics,
  getPastStreams,
} from '../../server/home/home-functions'
import { canonicalHomeSearch } from './home-search'
import { operatorDay } from './operator-day'
import type { HomeSearch } from './home-types'

const SECOND = 1_000
const MINUTE = 60 * SECOND
const GC_TIME = 10 * MINUTE

export const homeQueryKeys = {
  rooms: (search: HomeSearch) => ['home', 'rooms', canonicalHomeSearch(search)] as const,
  profiles: (query: string) => ['home', 'profiles', { query }] as const,
  pastStreams: () => ['home', 'past-streams'] as const,
  facets: () => ['home', 'facets'] as const,
  statistics: (operatorDay: string) => ['home', 'statistics', { operatorDay }] as const,
  presence: () => ['home', 'presence'] as const,
}

export function homeRoomsQueryOptions(search: HomeSearch) {
  const canonical = canonicalHomeSearch(search)
  return queryOptions({
    queryKey: homeQueryKeys.rooms(canonical),
    queryFn: ({ signal }) => getHomeRooms({ data: canonical, signal }),
    staleTime: 15 * SECOND,
    gcTime: GC_TIME,
    placeholderData: keepPreviousData,
  })
}

export function homeProfilesQueryOptions(query: string | undefined) {
  const normalized = query?.trim() ?? ''
  return queryOptions({
    queryKey: homeQueryKeys.profiles(normalized),
    queryFn: ({ signal }) => getHomeProfiles({ data: { q: normalized }, signal }),
    enabled: normalized.length > 0,
    staleTime: MINUTE,
    gcTime: GC_TIME,
    placeholderData: keepPreviousData,
  })
}

export const pastStreamsQueryOptions = (enabled = true) =>
  queryOptions({
    queryKey: homeQueryKeys.pastStreams(),
    queryFn: ({ signal }) => getPastStreams({ signal }),
    enabled,
    staleTime: MINUTE,
    gcTime: GC_TIME,
  })

export const homeFacetsQueryOptions = () =>
  queryOptions({
    queryKey: homeQueryKeys.facets(),
    queryFn: ({ signal }) => getHomeFacets({ signal }),
    staleTime: 30 * SECOND,
    gcTime: GC_TIME,
  })


export const homeStatisticsQueryOptions = (day = operatorDay()) =>
  queryOptions({
    queryKey: homeQueryKeys.statistics(day),
    queryFn: ({ signal }) => getHomeStatistics({ data: { operatorDay: day }, signal }),
    staleTime: 30 * SECOND,
    gcTime: GC_TIME,
  })

export const connectedPresenceQueryOptions = () =>
  queryOptions({
    queryKey: homeQueryKeys.presence(),
    queryFn: ({ signal }) => getConnectedPresence({ signal }),
    staleTime: 15 * SECOND,
    gcTime: GC_TIME,
  })
