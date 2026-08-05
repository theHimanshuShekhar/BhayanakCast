import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { observeHome } from './home-observability'
import type { HomeAnalyticsSection } from '../../server/observability/home-analytics'

const subscribeToNothing = () => () => {}

/** False while rendering on the server and during the client's hydration render, true for
    every render after that.

    `useSyncExternalStore` is what makes this safe rather than a `useEffect` flag: React
    calls the third argument during SSR *and* again while hydrating, so both passes see the
    same value by construction instead of by luck. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  )
}

interface HomeSectionBoundaryProps {
  readonly queryKey: QueryKey
  readonly analyticsSection: HomeAnalyticsSection
  readonly label: string
  readonly pending: boolean
  readonly failed: boolean
  /** Set for a section the Home loader prefetches without awaiting.

      Those sections cannot agree across hydration on their own. The server renders before
      the prefetch resolves, but the dehydrated payload is serialized after it does, so the
      client's cache is ahead of the HTML it is hydrating: the server sent a skeleton and
      the client's first render wanted content. React then discarded and regenerated the
      subtree on every affected load.

      Holding the skeleton through the hydration render removes the disagreement at its
      source, and matches what DESIGN.md already specifies for these three — facets,
      statistics, and connected presence stream into shape-matched skeletons rather than
      blocking the route. An awaited section must not set this: its content belongs in the
      server-rendered HTML. */
  readonly streamed?: boolean
  readonly skeleton: ReactNode
  readonly children: ReactNode
}

export function HomeSectionBoundary({
  analyticsSection,
  queryKey,
  label,
  pending,
  failed,
  streamed = false,
  skeleton,
  children,
}: HomeSectionBoundaryProps) {
  const queryClient = useQueryClient()
  const [retrying, setRetrying] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const hydrated = useHydrated()
  const showFailure = failed || retrying
  // A streamed section stays on its skeleton until the client has hydrated, so the server
  // render and the hydration render cannot disagree about which branch to draw.
  const showSkeleton = streamed && !hydrated ? true : pending

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={`${label} section`}
      data-home-section={label}
      aria-busy={retrying || undefined}
      tabIndex={-1}
    >
      {/* A failed section shows the failure and nothing else. Rendering the
          children underneath put a live-looking `Filters` heading and its own
          "unavailable" copy directly below the boundary's own message, so the
          same outage was announced twice and the second one looked like
          working UI. */}
      {showSkeleton && !retrying ? (
        skeleton
      ) : showFailure ? (
        <>
          <p role="status" aria-live="polite">
            {retrying ? `${label} is updating.` : `${label} is unavailable.`}
          </p>
          <button
            type="button"
            onClick={async () => {
              observeHome({
                name: 'home_section_retried',
                properties: { section: analyticsSection },
              })
              setRetrying(true)
              await queryClient.refetchQueries({ queryKey, exact: true })
              setRetrying(false)
              requestAnimationFrame(() => {
                containerRef.current?.focus({ preventScroll: true })
              })
            }}
          >
            Retry
          </button>
        </>
      ) : (
        children
      )}
    </div>
  )
}
