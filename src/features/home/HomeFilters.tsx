import { useRef, useState } from 'react'
import { normalizeHomeValue } from './home-search'
import type { Facet, HomeFacets, HomeSearch } from './home-types'

interface HomeFiltersProps {
  readonly facets: HomeFacets | undefined
  readonly search: HomeSearch
  readonly onChange: (patch: Partial<HomeSearch>) => void
  readonly onClear: () => void
}

export function HomeFilters({ facets, search, onChange, onClear }: HomeFiltersProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const activeFilters = Boolean(search.category || search.tags?.length)

  return (
    <section aria-label="Filters" className="home-filters">
      <div className="home-filters__heading">
        <h2>Filters</h2>
        <p>
          {facets
            ? `${facets.categories.length} categories and ${facets.tags.length} tags available.`
            : 'Filter options are unavailable.'}
        </p>
      </div>

      <div className="home-filter-fields--desktop">
        <FilterFields
          facets={facets}
          idPrefix="desktop"
          onChange={onChange}
          search={search}
        />
      </div>
      <button
        className="home-filters__open"
        onClick={() => dialog.current?.showModal()}
        type="button"
      >
        Filters
      </button>
      <dialog
        aria-labelledby="home-filter-sheet-title"
        className="home-filter-sheet"
        ref={dialog}
      >
        <div className="home-filter-sheet__heading">
          <h2 id="home-filter-sheet-title">Filters</h2>
          <button
            aria-label="Close filters"
            onClick={() => dialog.current?.close()}
            type="button"
          >
            Close
          </button>
        </div>
        <FilterFields
          facets={facets}
          idPrefix="mobile"
          onChange={onChange}
          search={search}
        />
      </dialog>

      {(activeFilters || search.q) && (
        <div className="home-active-filters" aria-label="Active search and filters">
          {search.category && (
            <button
              aria-label={`Remove category ${search.category}`}
              className="home-filter-chip"
              onClick={() => onChange({ category: undefined })}
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
                onChange({
                  tags: search.tags?.filter((selected) => selected !== tag),
                })
              }
              type="button"
            >
              #{tag} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button
            className="home-filters__clear"
            onClick={onClear}
            type="button"
          >
            Clear all
          </button>
        </div>
      )}
    </section>
  )
}

function FilterFields({
  facets,
  idPrefix,
  search,
  onChange,
}: Omit<HomeFiltersProps, 'onClear'> & Readonly<{ idPrefix: string }>) {
  const routeCategory = search.category ?? ''
  const [categoryState, setCategoryState] = useState({
    routeCategory,
    draft: routeCategory,
  })
  const [tagDraft, setTagDraft] = useState('')
  let categoryDraft = categoryState.draft
  if (categoryState.routeCategory !== routeCategory) {
    categoryDraft = routeCategory
    setCategoryState({ routeCategory, draft: routeCategory })
  }

  const matchFacet = (options: readonly Facet[], value: string) => {
    const normalized = normalizeHomeValue(value).toLocaleLowerCase()
    return options.find(
      (option) => normalizeHomeValue(option.value).toLocaleLowerCase() === normalized,
    )
  }
  const categories = facets?.categories ?? []
  const tags = facets?.tags.filter(
    ({ value }) => !search.tags?.includes(value),
  ) ?? []

  return (
    <div className="home-filter-fields">
      <label htmlFor={`${idPrefix}-category-filter`}>Category</label>
      <input
        id={`${idPrefix}-category-filter`}
        list={`${idPrefix}-category-options`}
        onBlur={() => {
          if (!matchFacet(categories, categoryDraft)) {
            setCategoryState({ routeCategory, draft: routeCategory })
          }
        }}
        onChange={(event) => {
          const value = event.currentTarget.value
          setCategoryState({ routeCategory, draft: value })
          if (!value) {
            onChange({ category: undefined })
            return
          }
          const selected = matchFacet(categories, value)
          if (selected) onChange({ category: selected.value })
        }}
        placeholder="Any category"
        type="text"
        value={categoryDraft}
      />
      <datalist id={`${idPrefix}-category-options`}>
        {categories.map((option) => (
          <option key={option.value} value={option.value}>
            {option.count} {option.count === 1 ? 'room' : 'rooms'}
          </option>
        ))}
      </datalist>

      <label htmlFor={`${idPrefix}-tag-filter`}>Add tag</label>
      <input
        id={`${idPrefix}-tag-filter`}
        list={`${idPrefix}-tag-options`}
        onBlur={() => setTagDraft('')}
        onChange={(event) => {
          const value = event.currentTarget.value
          setTagDraft(value)
          const selected = matchFacet(tags, value)
          if (!selected) return
          onChange({ tags: [...(search.tags ?? []), selected.value] })
          setTagDraft('')
        }}
        placeholder="Search tags"
        type="text"
        value={tagDraft}
      />
      <datalist id={`${idPrefix}-tag-options`}>
        {tags.map((option) => (
          <option key={option.value} value={option.value}>
            {option.count} {option.count === 1 ? 'room' : 'rooms'}
          </option>
        ))}
      </datalist>
    </div>
  )
}
