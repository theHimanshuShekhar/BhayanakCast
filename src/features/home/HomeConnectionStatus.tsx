export type HomeConnectionState = 'idle' | 'reconnecting' | 'error' | 'replaced' | 'revoked'

export function HomeConnectionStatus({
  state,
  onRetry,
}: Readonly<{ state: HomeConnectionState; onRetry?: () => void }>) {
  if (state === 'idle') return null
  return (
    <p
      aria-live="polite"
      className="home-connection-status"
      data-testid="home-connection-status"
      role="status"
    >
      {state === 'reconnecting'
        ? 'Reconnecting…'
        : state === 'replaced'
          ? 'This account connected elsewhere.'
          : state === 'revoked'
            ? 'Session ended.'
            : 'Live updates unavailable.'}
      {state === 'error' && onRetry ? (
        <button
          aria-label="Retry live Home updates"
          className="home-connection-retry"
          data-testid="home-connection-retry"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      ) : null}
    </p>
  )
}
