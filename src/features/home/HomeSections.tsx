import type { QueryKey } from '@tanstack/react-query'
import { HomeSectionBoundary } from './HomeSectionBoundary'
import {
  HomePastStreamsSkeleton,
  HomeRoomsSkeleton,
} from './HomeSectionSkeletons'
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
  readonly profiles: QuerySection<PublicProfileSummary>
  readonly pastStreams: QuerySection<PastStreamSummary>
}

export function HomeSections({
  search,
  rooms,
  profiles,
  pastStreams,
}: HomeSectionsProps) {
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
          <section aria-label="Live Rooms" className="home-section-content">
            <h2>Live Rooms</h2>
            <p>{rooms.data?.length ?? 0} rooms available.</p>
          </section>
        </HomeSectionBoundary>
      </section>

      {search.q ? (
        <section className="home-center-section" data-home-center-region="profiles">
          <HomeSectionBoundary
            failed={profiles.failed}
            label="Public Profiles"
            pending={profiles.pending && !profiles.data}
            queryKey={profiles.queryKey}
            skeleton={<HomeRoomsSkeleton label="Loading public profiles" />}
          >
            <section aria-label="Public Profiles" className="home-section-content">
              <h2>Public Profiles</h2>
              <p>{profiles.data?.length ?? 0} profiles available.</p>
            </section>
          </HomeSectionBoundary>
        </section>
      ) : (
        <section className="home-center-section" data-home-center-region="past-streams">
          <HomeSectionBoundary
            failed={pastStreams.failed}
            label="Past Streams"
            pending={pastStreams.pending && !pastStreams.data}
            queryKey={pastStreams.queryKey}
            skeleton={<HomePastStreamsSkeleton />}
          >
            <section aria-label="Past Streams" className="home-section-content">
              <h2>Past Streams</h2>
              <p>{pastStreams.data?.length ?? 0} streams available.</p>
            </section>
          </HomeSectionBoundary>
        </section>
      )}
    </>
  )
}
