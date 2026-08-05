import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useDebouncer } from '@tanstack/react-pacer'
import type { QueryKey } from '@tanstack/react-query'
import { HomeFilters } from './HomeFilters'
import { HomeSectionBoundary } from './HomeSectionBoundary'
import { HomeMetricsSkeleton } from './HomeSectionSkeletons'
import { canonicalHomeSearch } from './home-search'
import { observeHome } from './home-observability'
import type { HomeFacets, HomeSearch as HomeSearchValue } from './home-types'

/** A patch may be a function of the previous search, and any patch that builds
    on the current value must be. A tag added from a render whose `search` prop
    has not caught up with the URL yet would otherwise spread a stale array over
    the newer one and silently drop the tag before it. */
export type HomeSearchPatch =
  | Partial<HomeSearchValue>
  | ((previous: HomeSearchValue) => Partial<HomeSearchValue>)

interface HomeSearchProps {
  /** The masthead's own action, rendered inside the control row. It has to sit
      between the controls and the chips in the DOM so that reading order,
      focus order and the rendered row all agree. */
  readonly children: ReactNode
  readonly search: HomeSearchValue
  readonly facets: HomeFacets | undefined
  readonly facetsPending: boolean
  readonly facetsFailed: boolean
  readonly facetsQueryKey: QueryKey
}

export function HomeSearch({
  children,
  search,
  facets,
  facetsPending,
  facetsFailed,
  facetsQueryKey,
}: HomeSearchProps) {
  const navigate = useNavigate({ from: '/' })
  const routeQuery = search.q ?? ''
  const [queryState, setQueryState] = useState({
    routeQuery,
    draft: routeQuery,
  })
  let draft = queryState.draft
  if (queryState.routeQuery !== routeQuery) {
    draft = routeQuery
    setQueryState({ routeQuery, draft: routeQuery })
  }

  const updateSearch = (patch: HomeSearchPatch) =>
    void navigate({
      replace: true,
      search: (previous) => {
        const next = canonicalHomeSearch({
          ...previous,
          ...(typeof patch === 'function' ? patch(previous) : patch),
        })
        observeHome({
          name: 'home_search_applied',
          properties: {
            has_text_query: Boolean(next.q),
            category_selected: Boolean(next.category),
            tag_count: next.tags?.length ?? 0,
          },
        })
        return next
      },
    })
  const debouncer = useDebouncer(
    (query: string) => updateSearch({ q: query || undefined }),
    { wait: 250 },
  )
  const clearSearch = () => {
    debouncer.cancel()
    setQueryState({ routeQuery, draft: '' })
    updateSearch({ q: undefined, category: undefined, tags: undefined })
  }

  return (
    <>
      <div aria-label="Find rooms and people" className="home-search" role="search">
        {/* The field carries its own name in the icon and the placeholder, so
            the label is for the accessibility tree only. Rendered, it read as a
            section heading over what is one control in a row of controls. */}
        <label className="visually-hidden" htmlFor="home-search-input">
          Find rooms and people
        </label>
        <div className="home-search__field">
          <SearchIcon />
          <input
            id="home-search-input"
            name="q"
            onChange={(event) => {
              const query = event.currentTarget.value
              setQueryState({ routeQuery, draft: query })
              debouncer.maybeExecute(query)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              debouncer.flush()
            }}
            placeholder="Search rooms, tags, people"
            type="search"
            value={draft}
          />
          {/* On the field's own line, not a row under it: reserved below, the
              empty status pushed every section down by its line box. */}
          <debouncer.Subscribe selector={(state) => state.isPending}>
            {(isPending) => (
              <span
                aria-label="Search pending"
                className="home-search__pending"
                role="status"
              >
                {isPending ? 'Waiting to search…' : ''}
              </span>
            )}
          </debouncer.Subscribe>
        </div>
      </div>

      <HomeSectionBoundary
        analyticsSection="filters"
        failed={facetsFailed}
        label="Filters"
        pending={facetsPending && !facets}
        queryKey={facetsQueryKey}
        streamed
        skeleton={<HomeMetricsSkeleton label="Loading filters" />}
      >
        <HomeFilters facets={facets} onChange={updateSearch} search={search} />
      </HomeSectionBoundary>

      {children}

      {/* Sibling of the controls rather than a child of the filter sheet: the
          chips summarise the whole query, and Clear all clears the text with
          them. Inside Filters they widened the control they sat in. */}
      {(search.q || search.category || search.tags?.length) && (
        <div className="home-active-filters" aria-label="Active search and filters">
          {search.category && (
            <button
              aria-label={`Remove category ${search.category}`}
              className="home-filter-chip"
              onClick={() => updateSearch({ category: undefined })}
              type="button"
            >
              Category: {search.category} <span aria-hidden="true">×</span>
            </button>
          )}
          {search.tags?.map((tag) => (
            <button
              aria-label={`Remove tag ${tag}`}
              className="home-filter-chip"
              key={tag}
              onClick={() =>
                updateSearch((previous) => ({
                  tags: previous.tags?.filter((selected) => selected !== tag),
                }))
              }
              type="button"
            >
              #{tag} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button className="home-filters__clear" onClick={clearSearch} type="button">
            Clear all
          </button>
        </div>
      )}
    </>
  )
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 4 4" />
    </svg>
  )
}
