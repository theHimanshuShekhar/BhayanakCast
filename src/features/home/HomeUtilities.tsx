import type { QueryKey } from '@tanstack/react-query'
import { SignInButton } from '../auth/SignInButton'
import type { SessionProjection } from '../auth/auth-client'
import { CreateRoomButton } from './HomeNavigation'
import { HomeRealtimeBridge } from './home-realtime'
import { HomeSearch as HomeSearchController } from './HomeSearch'
import { HomeSectionBoundary } from './HomeSectionBoundary'
import { HomeMetricsSkeleton } from './HomeSectionSkeletons'
import type {
  ConnectedPresence,
  HomeFacets,
  HomeSearch,
  HomeStatistics,
} from './home-types'

interface HomeUtilitiesProps {
  readonly search: HomeSearch
  readonly session: SessionProjection | null
  readonly facets: HomeFacets | undefined
  readonly facetsPending: boolean
  readonly facetsFailed: boolean
  readonly facetsQueryKey: QueryKey
  readonly statistics: HomeStatistics | undefined
  readonly statisticsPending: boolean
  readonly statisticsFailed: boolean
  readonly statisticsQueryKey: QueryKey
  readonly presence: ConnectedPresence | undefined
  readonly presencePending: boolean
  readonly presenceFailed: boolean
  readonly presenceQueryKey: QueryKey
  /** What the current search resolved to, once it has landed. Undefined while
      the first fetch is in flight — the counter shows a dash rather than
      claiming zero. `profileCount` stays undefined when the search has no free
      text, because profiles are only searched by name. */
  readonly roomCount: number | undefined
  readonly profileCount: number | undefined
  readonly onCanonicalRefresh: () => void
}

export function HomeUtilities({
  search,
  session,
  facets,
  facetsPending,
  facetsFailed,
  facetsQueryKey,
  statistics,
  statisticsPending,
  statisticsFailed,
  statisticsQueryKey,
  presence,
  presencePending,
  presenceFailed,
  presenceQueryKey,
  roomCount,
  profileCount,
  onCanonicalRefresh,
}: HomeUtilitiesProps) {
  const hasActiveSearch = Boolean(search.q || search.category || search.tags?.length)

  return (
    <>
      <section
        className={`home-masthead${hasActiveSearch ? ' home-masthead--searching' : ''}`}
        data-home-center-region="search"
        data-testid="home-masthead"
      >
        <HomeRealtimeBridge
          enabled={Boolean(session)}
          onCanonicalRefresh={onCanonicalRefresh}
        />
        <HomeSectionBoundary
          failed={presenceFailed}
          label="Connected presence"
          pending={presencePending && !presence}
          queryKey={presenceQueryKey}
          skeleton={<HomeMetricsSkeleton label="Loading connected presence" />}
        >
          <PresenceCounter
            anonymous={!session}
            hasActiveSearch={hasActiveSearch}
            presence={presence}
            profileCount={profileCount}
            query={search.q}
            roomCount={roomCount}
          />
        </HomeSectionBoundary>
        <div className="home-masthead__actions">
          <HomeSearchController
            facets={facets}
            facetsFailed={facetsFailed}
            facetsPending={facetsPending}
            facetsQueryKey={facetsQueryKey}
            search={search}
          />
          {session ? (
            <CreateRoomButton className="home-masthead__create" label="Open a room" />
          ) : (
            <SignInButton label="Sign in" />
          )}
        </div>
      </section>

      {!hasActiveSearch && (
        <HomeSectionBoundary
          failed={statisticsFailed}
          label="Statistics"
          pending={statisticsPending && !statistics}
          queryKey={statisticsQueryKey}
          skeleton={<HomeMetricsSkeleton label="Loading statistics" />}
        >
          <StatisticsStrip statistics={statistics} />
        </HomeSectionBoundary>
      )}
    </>
  )
}

/** The page's largest thing. What it counts changes with the page state; the
    block never changes shape, so nothing below it moves. */
function PresenceCounter({
  presence,
  hasActiveSearch,
  roomCount,
  profileCount,
  query,
  anonymous,
}: Readonly<{
  presence: ConnectedPresence | undefined
  hasActiveSearch: boolean
  roomCount: number | undefined
  profileCount: number | undefined
  query: string | undefined
  anonymous: boolean
}>) {
  const connected = presence?.connectedAccountCount
  return (
    <div className="home-counter" data-testid="home-counter">
      <p className="home-counter__eyebrow">
        <span aria-hidden="true" className="home-pulse-dot" />
        {hasActiveSearch ? 'Search' : 'Right now'}
      </p>
      {/* Searching turns the counter into the breakdown sentence, so the
          per-group counts below it are the only place the split repeats. It is
          the live region for results now that the hidden duplicate is gone. */}
      <h1
        aria-live={hasActiveSearch ? 'polite' : undefined}
        className="home-counter__value"
      >
        {hasActiveSearch ? (
          <>
            <span className="tabular-nums">{roomCount ?? '—'}</span>{' '}
            <span className="home-counter__unit">
              {roomCount === 1 ? 'room' : 'rooms'}
              {profileCount !== undefined && (
                <>
                  {' and '}
                  <span className="tabular-nums">{profileCount}</span>{' '}
                  {profileCount === 1 ? 'person' : 'people'}
                </>
              )}{' '}
              {roomCount === 1 && profileCount === undefined ? 'matches' : 'match'}{' '}
              {query ? `“${query}”` : 'these filters'}
            </span>
          </>
        ) : (
          <>
            <span className="tabular-nums">{connected ?? '—'}</span>{' '}
            <span className="home-counter__unit">
              {connected === 1 ? 'person in the clubhouse' : 'people in the clubhouse'}
            </span>
          </>
        )}
      </h1>
      {anonymous && !hasActiveSearch && (
        <p className="home-counter__explainer">
          Browse every public room without an account. Signing in is what lets you
          join one or open your own.
        </p>
      )}
    </div>
  )
}

/** Five cells, always open. A disclosure here hid the only numbers that told a
    visitor whether the clubhouse was worth staying in. */
function StatisticsStrip({
  statistics,
}: Readonly<{ statistics: HomeStatistics | undefined }>) {
  return (
    <section aria-label="Statistics" className="home-statistics" data-testid="home-statistics">
      <h2 className="visually-hidden">Statistics</h2>
      <dl>
        <Metric label="rooms live" value={statistics?.activeRoomCount} />
        <Metric label="screens shared" value={statistics?.activeStreamCount} />
        <Metric label="sitting in rooms" value={statistics?.currentMembershipCount} />
        <Metric label="opened today" value={statistics?.roomsCreatedToday} />
        <Metric label="peak today" value={statistics?.peakConnectedAccountCount} />
      </dl>
    </section>
  )
}

function Metric({ label, value }: Readonly<{ label: string; value: number | undefined }>) {
  return (
    // Value renders above the label; the DOM keeps dt-then-dd because a dl
    // group is only valid in that order.
    <div className="home-statistics__cell">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value ?? '—'}</dd>
    </div>
  )
}
