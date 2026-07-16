import { useQuery } from '@tanstack/react-query'
import type { SessionProjection } from '../auth/auth-client'
import { HomeNavigation } from './HomeNavigation'
import { HomeSections } from './HomeSections'
import { HomeUtilities } from './HomeUtilities'
import {
  connectedPresenceQueryOptions,
  homeFacetsQueryOptions,
  homeProfilesQueryOptions,
  homeRoomsQueryOptions,
  homeStatisticsQueryOptions,
  pastStreamsQueryOptions,
} from './home-queries'
import type { HomeSearch } from './home-types'

interface HomePageProps {
  readonly search: HomeSearch
  readonly session: SessionProjection | null
}

export function HomePage({ search, session }: HomePageProps) {
  const roomsOptions = homeRoomsQueryOptions(search)
  const profilesOptions = homeProfilesQueryOptions(search.q)
  const pastStreamsOptions = pastStreamsQueryOptions(!search.q)
  const facetsOptions = homeFacetsQueryOptions()
  const statisticsOptions = homeStatisticsQueryOptions()
  const presenceOptions = connectedPresenceQueryOptions()
  const rooms = useQuery(roomsOptions)
  const profiles = useQuery(profilesOptions)
  const pastStreams = useQuery(pastStreamsOptions)
  const facets = useQuery(facetsOptions)
  const statistics = useQuery(statisticsOptions)
  const presence = useQuery(presenceOptions)

  return (
    <div className="home-shell" data-testid="home-shell">
      <HomeNavigation
        presence={presence.data}
        presenceFailed={presence.isError}
        presencePending={presence.isPending}
        presenceQueryKey={presenceOptions.queryKey}
        session={session}
      />
      <main className="home-main">
        <HomeUtilities
          facets={facets.data}
          facetsFailed={facets.isError}
          facetsPending={facets.isPending}
          facetsQueryKey={facetsOptions.queryKey}
          search={search}
          session={session}
          statistics={statistics.data}
          statisticsFailed={statistics.isError}
          statisticsPending={statistics.isPending}
          statisticsQueryKey={statisticsOptions.queryKey}
        />
        <HomeSections
          pastStreams={{
            data: pastStreams.data,
            failed: pastStreams.isError,
            pending: pastStreams.isPending,
            queryKey: pastStreamsOptions.queryKey,
          }}
          profiles={{
            data: profiles.data,
            failed: profiles.isError,
            pending: profiles.isPending,
            queryKey: profilesOptions.queryKey,
            updating: profiles.isPlaceholderData,
          }}
          rooms={{
            data: rooms.data,
            failed: rooms.isError,
            pending: rooms.isPending,
            queryKey: roomsOptions.queryKey,
            updating: rooms.isPlaceholderData,
          }}
          search={search}
        />
      </main>
    </div>
  )
}
