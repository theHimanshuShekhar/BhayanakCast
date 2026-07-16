import type { QueryKey } from '@tanstack/react-query'
import { HomeSectionBoundary } from './HomeSectionBoundary'
import {
  HomePastStreamsSkeleton,
  HomeRoomsSkeleton,
} from './HomeSectionSkeletons'
import { HomeSearchResults } from './HomeSearchResults'
import { LiveRooms } from './LiveRooms'
import { PastStreams } from './PastStreams'
import type {
  ActiveRoomSummary,
  HomeSearch,
  PastStreamSummary,
  PublicProfileSummary,
} from './home-types'

interface QuerySection<T> {
  readonly data: readonly T[] | undefined
  readonly pending: boolean
  readonly failed: boolean
  readonly queryKey: QueryKey
}

interface HomeSectionsProps {
  readonly search: HomeSearch
  readonly rooms: QuerySection<ActiveRoomSummary> & { readonly updating: boolean }
  readonly profiles: QuerySection<PublicProfileSummary> & { readonly updating: boolean }
  readonly pastStreams: QuerySection<PastStreamSummary>
}

export function HomeSections({
  search,
  rooms,
  profiles,
  pastStreams,
}: HomeSectionsProps) {
  const hasActiveDiscoveryContext = Boolean(
    search.q || search.category || search.tags?.length,
  )
  if (hasActiveDiscoveryContext) {
    return (
      <HomeSearchResults
        profiles={profiles}
        query={search.q}
        rooms={rooms}
      />
    )
  }
  const snapshotKey = JSON.stringify([
    search.q ?? '',
    search.category ?? '',
    search.tags ?? [],
  ])
  const showPastStreams =
    pastStreams.data === undefined || pastStreams.data.length > 0
  return (
    <>
      <section className="home-center-section" data-home-center-region="live-rooms">
        {rooms.updating && <p role="status">Updating room results.</p>}
        <HomeSectionBoundary
          failed={rooms.failed}
          label="Live Rooms"
          pending={rooms.pending && !rooms.data}
          queryKey={rooms.queryKey}
          skeleton={<HomeRoomsSkeleton />}
        >
          <LiveRooms
            hasPastStreams={showPastStreams}
            isPlaceholderData={rooms.updating}
            rooms={rooms.data ?? []}
            showEmptyInvitation={!hasActiveDiscoveryContext}
            snapshotKey={snapshotKey}
          />
        </HomeSectionBoundary>
      </section>

      {showPastStreams ? (
        <section className="home-center-section" data-home-center-region="past-streams">
          <HomeSectionBoundary
            failed={pastStreams.failed}
            label="Past Streams"
            pending={pastStreams.pending && !pastStreams.data}
            queryKey={pastStreams.queryKey}
            skeleton={<HomePastStreamsSkeleton />}
          >
            <PastStreams streams={pastStreams.data ?? []} />
          </HomeSectionBoundary>
        </section>
      ) : null}
    </>
  )
}
