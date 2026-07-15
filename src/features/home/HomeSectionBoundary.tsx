import { useRef, useState, type ReactNode } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'

interface HomeSectionBoundaryProps {
  readonly queryKey: QueryKey
  readonly label: string
  readonly pending: boolean
  readonly failed: boolean
  readonly skeleton: ReactNode
  readonly children: ReactNode
}

export function HomeSectionBoundary({
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
      aria-busy={retrying || undefined}
      tabIndex={-1}
    >
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
          {children}
        </>
      ) : (
        children
      )}
    </div>
  )
}
