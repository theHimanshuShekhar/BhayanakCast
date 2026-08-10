import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SessionProjection } from '../auth/auth-client'
import { CreateRoomDialog } from './CreateRoomDialog'
import { HomeNavigation } from './HomeNavigation'
import { HomeRail } from './HomeRail'
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
import { observeHome } from './home-observability'
import type { HomeSearch } from './home-types'

interface HomePageProps {
  readonly search: HomeSearch
  readonly session: SessionProjection | null
}

export function HomePage({ search, session }: HomePageProps) {
  const observedView = useRef(false)
  useEffect(() => {
    if (observedView.current) return
    observedView.current = true
    observeHome({
      name: 'home_viewed',
      properties: { mode: search.q ? 'search' : 'discovery' },
    })
  }, [search.q])
  const [realtimeRefreshVersion, setRealtimeRefreshVersion] = useState(0)
  const onCanonicalRefresh = useCallback(
    () => setRealtimeRefreshVersion((version) => version + 1),
    [],
  )
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
  const hasActiveSearch = Boolean(search.q || search.category || search.tags?.length)

  return (
    <div className="home-shell" data-testid="home-shell">
      <HomeNavigation presence={presence.data} session={session} />
      <main className="home-main">
        <HomeUtilities
          facets={facets.data}
          facetsFailed={facets.isError}
          facetsPending={facets.isPending}
          facetsQueryKey={facetsOptions.queryKey}
          presence={presence.data}
          presenceFailed={presence.isError}
          presencePending={presence.isPending}
          presenceQueryKey={presenceOptions.queryKey}
          profileCount={search.q ? profiles.data?.length : undefined}
          roomCount={rooms.data?.length}
          search={search}
          session={session}
          onCanonicalRefresh={onCanonicalRefresh}
        />
        {/* The centre column, wrapped so the rail beside it has something to be
            beside. Below 1280px the wrapper is display:contents and both it and
            the rail vanish from the box tree, leaving today's single column. */}
        <div className="home-sections">
          <HomeSections
            canJoin={Boolean(session)}
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
            realtimeRefreshVersion={realtimeRefreshVersion}
          />
        </div>
        <HomeRail
          hasActiveSearch={hasActiveSearch}
          presence={presence.data}
          session={session}
          statistics={statistics.data}
          statisticsFailed={statistics.isError}
          statisticsPending={statistics.isPending}
          statisticsQueryKey={statisticsOptions.queryKey}
        />
        <CreateRoomDialog session={session} />
      </main>
    </div>
  )
}
