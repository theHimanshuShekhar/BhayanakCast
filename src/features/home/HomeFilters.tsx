import { useRef, useState } from 'react'
import { normalizeHomeValue } from './home-search'
import type { HomeSearchPatch } from './HomeSearch'
import type { Facet, HomeFacets, HomeSearch } from './home-types'

interface HomeFiltersProps {
  readonly facets: HomeFacets | undefined
  readonly search: HomeSearch
  readonly onChange: (patch: HomeSearchPatch) => void
}

export function HomeFilters({ facets, search, onChange }: HomeFiltersProps) {
  const dialog = useRef<HTMLDialogElement>(null)

  return (
    <section aria-label="Filters" className="home-filters">
      {/* The section still needs a name for the heading list, but a visible
          "Filters" title over the button that opens the filters said it
          twice. */}
      <h2 className="visually-hidden">Filters</h2>

      {/* One filter path at every width. The wide stage used to inline its own
          copy of the fields beside a sheet only phones could open, so the same
          two facets had two different controls and two sets of state to keep
          honest. */}
      <button
        className="home-filters__open"
        onClick={() => dialog.current?.showModal()}
        type="button"
      >
        <FiltersIcon />
        <span>Filters</span>
      </button>
      <dialog
        aria-labelledby="home-filter-sheet-title"
        className="home-filter-sheet"
        ref={dialog}
      >
        <div className="home-filter-sheet__heading">
          {/* Distinct from the enclosing `Filters` section heading: with both
              named `Filters`, a heading list read two identical entries and
              gave no clue which one was the open sheet. */}
          <h2 id="home-filter-sheet-title">Filter rooms</h2>
          <button
            aria-label="Close filters"
            onClick={() => dialog.current?.close()}
            type="button"
          >
            Close
          </button>
        </div>
        <FilterFields facets={facets} onChange={onChange} search={search} />
        {/* What is on offer belongs with the fields that offer it, not on the
            page outside the closed sheet. */}
        <p className="home-filters__facets">
          {facets
            ? `${facets.categories.length} ${facets.categories.length === 1 ? 'category' : 'categories'} and ${facets.tags.length} ${facets.tags.length === 1 ? 'tag' : 'tags'} available.`
            : 'Filter options are unavailable.'}
        </p>
      </dialog>
    </section>
  )
}

function FiltersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h5m4 0h7M4 17h11m4 0h1" />
      <circle cx="11" cy="7" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  )
}

function FilterFields({
  facets,
  search,
  onChange,
}: HomeFiltersProps) {
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
      <label htmlFor="sheet-category-filter">Category</label>
      <input
        id="sheet-category-filter"
        list="sheet-category-options"
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
      <datalist id="sheet-category-options">
        {categories.map((option) => (
          <option key={option.value} value={option.value}>
            {option.count} {option.count === 1 ? 'room' : 'rooms'}
          </option>
        ))}
      </datalist>

      <label htmlFor="sheet-tag-filter">Add tag</label>
      <input
        id="sheet-tag-filter"
        list="sheet-tag-options"
        onBlur={() => setTagDraft('')}
        onChange={(event) => {
          const value = event.currentTarget.value
          setTagDraft(value)
          const selected = matchFacet(tags, value)
          if (!selected) return
          onChange((previous) => ({
            tags: [...(previous.tags ?? []), selected.value],
          }))
          setTagDraft('')
        }}
        placeholder="Search tags"
        type="text"
        value={tagDraft}
      />
      <datalist id="sheet-tag-options">
        {tags.map((option) => (
          <option key={option.value} value={option.value}>
            {option.count} {option.count === 1 ? 'room' : 'rooms'}
          </option>
        ))}
      </datalist>
    </div>
  )
}
