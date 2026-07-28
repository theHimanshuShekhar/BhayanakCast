import { useEffect, useState } from 'react'

export type HomeConnectionState =
  | 'idle'
  | 'reconnecting'
  | 'error'
  | 'replaced'
  | 'revoked'
  | 'recovered'

/** `recovered` is the only self-retiring state: it confirms the counts caught
    up and then gets out of the way. */
export const RECOVERED_RETIRE_MS = 1200

/** How often the elapsed-time copy refreshes. Coarse on purpose — the strip is
    the only thing that re-renders, but a per-second clock would still make the
    sentence flicker for no added truth. */
const ELAPSED_TICK_MS = 5000

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'always' })

/** Rounded to five seconds under a minute, then to whole minutes and hours.
    The reader wants to know whether the data is stale, not how stale. */
export function lastSeenLabel(elapsedMs: number) {
  const seconds = Math.max(5, Math.round(Math.max(0, elapsedMs) / 5000) * 5)
  if (seconds < 60) return RELATIVE.format(-seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return RELATIVE.format(-minutes, 'minute')
  return RELATIVE.format(-Math.round(minutes / 60), 'hour')
}

const LABELS: Partial<Record<HomeConnectionState, string>> = {
  reconnecting: 'Reconnecting',
  error: 'Offline',
  recovered: 'Back online',
}

function noteFor(state: HomeConnectionState, elapsedMs: number) {
  switch (state) {
    case 'reconnecting':
      return `Counts are paused — last seen ${lastSeenLabel(elapsedMs)}.`
    case 'error':
      return `You're seeing rooms as they were ${lastSeenLabel(elapsedMs)}.`
    case 'recovered':
      return 'Rooms are current again.'
    case 'replaced':
      return 'This account connected elsewhere.'
    default:
      return 'Session ended.'
  }
}

/** A 3px bar pinned above the page: it changes colour and motion but never
    displaces content, so a dropped socket does not reflow the room grid. The
    bar alone is not a message, so every state also carries a status line. */
export function HomeConnectionStatus({
  state,
  lastEventAt,
  attempt = 0,
  onRetry,
}: Readonly<{
  state: HomeConnectionState
  /** When the socket last delivered canonical data, so a paused strip can say
      how far behind the page has fallen. */
  lastEventAt?: number
  /** Reconnection attempts since the connection was last healthy. */
  attempt?: number
  onRetry?: () => void
}>) {
  const stale = state === 'reconnecting' || state === 'error'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!stale) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS)
    return () => clearInterval(timer)
  }, [stale])

  if (state === 'idle') return null
  const label = LABELS[state]
  return (
    <div
      className="home-connection-status"
      data-state={state}
      data-testid="home-connection-status"
    >
      <span aria-hidden="true" className="home-connection-status__bar" />
      <p aria-live="polite" className="home-connection-status__note" role="status">
        {label && <span className="home-connection-status__label">{label}</span>}
        {noteFor(state, now - (lastEventAt ?? now))}
        {stale && attempt > 0 && (
          <span className="home-connection-status__attempt tabular-nums">
            attempt {attempt}
          </span>
        )}
        {state === 'error' && onRetry ? (
          <button
            aria-label="Retry live Home updates"
            className="home-connection-retry"
            data-testid="home-connection-retry"
            onClick={onRetry}
            type="button"
          >
            Try now
          </button>
        ) : null}
      </p>
    </div>
  )
}
