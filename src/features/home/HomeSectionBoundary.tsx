import { useRef, useState, type ReactNode } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { observeHome } from './home-observability'
import type { HomeAnalyticsSection } from '../../server/observability/home-analytics'

interface HomeSectionBoundaryProps {
  readonly queryKey: QueryKey
  readonly analyticsSection: HomeAnalyticsSection
  readonly label: string
  readonly pending: boolean
  readonly failed: boolean
  readonly skeleton: ReactNode
  readonly children: ReactNode
}

export function HomeSectionBoundary({
  analyticsSection,
  queryKey,
  label,
  pending,
  failed,
  skeleton,
  children,
}: HomeSectionBoundaryProps) {
  const queryClient = useQueryClient()
  const [retrying, setRetrying] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const showFailure = failed || retrying

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
      {pending && !retrying ? (
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
