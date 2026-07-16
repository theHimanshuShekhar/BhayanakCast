import type { QueryKey } from '@tanstack/react-query'
import { HomeSectionBoundary } from './HomeSectionBoundary'
import { HomeRoomsSkeleton } from './HomeSectionSkeletons'
import { ProfileSearchResult } from './ProfileSearchResult'
import { RoomSearchResult } from './RoomSearchResult'
import type {
  ActiveRoomSummary,
  PublicProfileSummary,
} from './home-types'

interface ResultSection<T> {
  readonly data: readonly T[] | undefined
  readonly pending: boolean
  readonly failed: boolean
  readonly updating: boolean
  readonly queryKey: QueryKey
}

interface HomeSearchResultsProps {
  readonly query: string | undefined
  readonly rooms: ResultSection<ActiveRoomSummary>
  readonly profiles: ResultSection<PublicProfileSummary>
}

export function HomeSearchResults({
  query,
  rooms,
  profiles,
}: HomeSearchResultsProps) {
  const roomCount = rooms.data?.length ?? 0
  const profileCount = query ? (profiles.data?.length ?? 0) : 0

  return (
    <>
      <section
        className="home-center-section home-search-results"
        data-home-center-region="live-rooms"
      >
        <HomeSectionBoundary
          failed={rooms.failed}
          label="Active Rooms"
          pending={rooms.pending && !rooms.data}
          queryKey={rooms.queryKey}
          skeleton={<HomeRoomsSkeleton label="Loading active room results" />}
        >
          <section aria-labelledby="active-room-results-heading">
            <div className="home-section-heading">
              <h2 id="active-room-results-heading">Active Rooms</h2>
              <p className="tabular-nums">
                {roomCount} {roomCount === 1 ? 'result' : 'results'}
              </p>
            </div>
            {rooms.updating && <p role="status">Updating active room results.</p>}
            {roomCount > 0 ? (
              <ol className="room-search-results-list">
                {rooms.data?.map((room) => (
                  <RoomSearchResult key={room.id} room={room} />
                ))}
              </ol>
            ) : (
              <p className="home-search-results__empty">
                No active rooms match this search.
              </p>
            )}
          </section>
        </HomeSectionBoundary>
      </section>

      {query && (
        <section
          className="home-center-section home-search-results"
          data-home-center-region="profiles"
        >
          <HomeSectionBoundary
            failed={profiles.failed}
            label="Public Profiles"
            pending={profiles.pending && !profiles.data}
            queryKey={profiles.queryKey}
            skeleton={<HomeRoomsSkeleton label="Loading public profile results" />}
          >
            <section aria-labelledby="profile-results-heading">
              <div className="home-section-heading">
                <h2 id="profile-results-heading">Public Profiles</h2>
                <p className="tabular-nums">
                  {profileCount} {profileCount === 1 ? 'result' : 'results'}
                </p>
              </div>
              {profiles.updating && (
                <p role="status">Updating public profile results.</p>
              )}
              {profileCount > 0 ? (
                <ol className="profile-search-results-list">
                  {profiles.data?.map((profile) => (
                    <ProfileSearchResult
                      key={profile.accountId}
                      profile={profile}
                    />
                  ))}
                </ol>
              ) : (
                <p className="home-search-results__empty">
                  No public profiles match this search.
                </p>
              )}
            </section>
          </HomeSectionBoundary>
        </section>
      )}

      <p
        aria-label="Search result count"
        aria-live="polite"
        className="visually-hidden"
        role="status"
      >
        {roomCount} active {roomCount === 1 ? 'room' : 'rooms'}
        {query
          ? ` and ${profileCount} public ${profileCount === 1 ? 'profile' : 'profiles'}`
          : ''}
      </p>
    </>
  )
}
