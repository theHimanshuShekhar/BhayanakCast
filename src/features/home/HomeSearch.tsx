import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useDebouncer } from '@tanstack/react-pacer'
import type { QueryKey } from '@tanstack/react-query'
import { HomeFilters } from './HomeFilters'
import { HomeSectionBoundary } from './HomeSectionBoundary'
import { HomeMetricsSkeleton } from './HomeSectionSkeletons'
import { canonicalHomeSearch } from './home-search'
import type { HomeFacets, HomeSearch as HomeSearchValue } from './home-types'

interface HomeSearchProps {
  readonly search: HomeSearchValue
  readonly facets: HomeFacets | undefined
  readonly facetsPending: boolean
  readonly facetsFailed: boolean
  readonly facetsQueryKey: QueryKey
}

export function HomeSearch({
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

  const updateSearch = (patch: Partial<HomeSearchValue>) =>
    void navigate({
      replace: true,
      search: (previous) => canonicalHomeSearch({ ...previous, ...patch }),
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
        <label htmlFor="home-search-input">Find rooms and people</label>
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
          placeholder="Search rooms, categories, tags, or people"
          type="search"
          value={draft}
        />
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

      <HomeSectionBoundary
        failed={facetsFailed}
        label="Filters"
        pending={facetsPending && !facets}
        queryKey={facetsQueryKey}
        skeleton={<HomeMetricsSkeleton label="Loading filters" />}
      >
        <HomeFilters
          facets={facets}
          onClear={clearSearch}
          onChange={updateSearch}
          search={search}
        />
      </HomeSectionBoundary>
    </>
  )
}
