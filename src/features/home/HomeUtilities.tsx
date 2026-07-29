import type { QueryKey } from '@tanstack/react-query'
import type { SessionProjection } from '../auth/auth-client'
import { CreateRoomButton } from './HomeNavigation'
import { HomeRealtimeBridge } from './home-realtime'
import { HomeSearch as HomeSearchController } from './HomeSearch'
import { HomeSectionBoundary } from './HomeSectionBoundary'
import { HomeMetricsSkeleton } from './HomeSectionSkeletons'
import type { ConnectedPresence, HomeFacets, HomeSearch } from './home-types'

interface HomeUtilitiesProps {
  readonly search: HomeSearch
  readonly session: SessionProjection | null
  readonly facets: HomeFacets | undefined
  readonly facetsPending: boolean
  readonly facetsFailed: boolean
  readonly facetsQueryKey: QueryKey
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
    <section
      className={`home-masthead${hasActiveSearch ? ' home-masthead--searching' : ''}`}
      data-home-center-region="search"
      data-testid="home-masthead"
    >
      {/* Anonymous visitors hold a socket too (ADR 0108): they are part of the
          count above, and a count that never moves is worse than no count. */}
      <HomeRealtimeBridge
        anonymous={!session}
        onCanonicalRefresh={onCanonicalRefresh}
      />
      {/* The presence query's one boundary, at every width. On the wide stage
          the rail draws the count and the counter below goes display:none, but
          this boundary keeps owning the pending and failed states so an outage
          is still reported somewhere visible. */}
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
        >
          {/* Same control in both states: anonymous activation starts Discord
              OAuth and returns here to reopen the dialog, so the action keeps
              its own label instead of being swapped for a sign-in button.
              Above 1280px the rail's card is this button, and this copy stands
              down rather than putting two "Open a room" on one screen. */}
          <CreateRoomButton className="home-masthead__create" label="Open a room" />
        </HomeSearchController>
      </div>
    </section>
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
  const connected = presence?.connectedCount
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
