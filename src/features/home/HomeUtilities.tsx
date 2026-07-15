import { useId, useState } from 'react'
import type { QueryKey } from '@tanstack/react-query'
import { SignInButton } from '../auth/SignInButton'
import type { SessionProjection } from '../auth/auth-client'
import { CreateRoomButton } from './HomeNavigation'
import { HomeSectionBoundary } from './HomeSectionBoundary'
import { HomeMetricsSkeleton } from './HomeSectionSkeletons'
import type { HomeFacets, HomeSearch, HomeStatistics } from './home-types'

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
}: HomeUtilitiesProps) {
  const hasActiveSearch = Boolean(search.q || search.category || search.tags?.length)

  return (
    <>
      <section
        className={`home-search-utilities${hasActiveSearch ? ' home-search-utilities--active' : ''}`}
        data-home-center-region="search"
      >
        <div aria-label="Find rooms and people" className="home-search" role="search">
          <label htmlFor="home-search-input">Find rooms and people</label>
          <input
            id="home-search-input"
            name="q"
            placeholder="Search rooms, categories, tags, or people"
            readOnly
            type="search"
            value={search.q ?? ''}
          />
        </div>
        <HomeSectionBoundary
          failed={facetsFailed}
          label="Filters"
          pending={facetsPending && !facets}
          queryKey={facetsQueryKey}
          skeleton={<HomeMetricsSkeleton label="Loading filters" />}
        >
          <section aria-label="Filters" className="home-filters">
            <h2>Filters</h2>
            <p>
              {facets ? `${facets.categories.length} categories and ${facets.tags.length} tags available.` : 'Filter options are unavailable.'}
            </p>
          </section>
        </HomeSectionBoundary>
      </section>

      <aside aria-label="Clubhouse activity" className="home-utilities-rail" data-testid="home-rail">
        <HomeSectionBoundary
          failed={statisticsFailed}
          label="Statistics"
          pending={statisticsPending && !statistics}
          queryKey={statisticsQueryKey}
          skeleton={<HomeMetricsSkeleton label="Loading statistics" />}
        >
          <StatisticsDisclosure statistics={statistics} />
        </HomeSectionBoundary>
        <section aria-label="Room creation" className="home-create-panel">
          <h2>Share together</h2>
          <p>Open a room for your community when you are ready.</p>
          {session ? (
            <CreateRoomButton className="home-create-panel__button" label="Start a room" />
          ) : (
            <SignInButton />
          )}
        </section>
      </aside>
    </>
  )
}

function StatisticsDisclosure({
  statistics,
}: Readonly<{ statistics: HomeStatistics | undefined }>) {
  const contentId = `home-statistics-${useId().replaceAll(':', '')}`
  const [expanded, setExpanded] = useState(false)
  return (
    <section
      aria-label="Statistics"
      className="home-statistics"
      data-expanded={expanded}
    >
      <button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="home-statistics__toggle"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        <span>Clubhouse statistics</span>
        <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      <div className="home-statistics__content" id={contentId}>
        <h2>Statistics</h2>
        <dl>
          <Metric label="Live Rooms" value={statistics?.activeRoomCount} />
          <Metric label="Active Streams" value={statistics?.activeStreamCount} />
          <Metric label="Room Memberships" value={statistics?.currentMembershipCount} />
          <Metric label="Rooms created today" value={statistics?.roomsCreatedToday} />
          <Metric label="Today’s peak Accounts" value={statistics?.peakConnectedAccountCount} />
        </dl>
      </div>
    </section>
  )
}

function Metric({ label, value }: Readonly<{ label: string; value: number | undefined }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value ?? '—'}</dd>
    </div>
  )
}
