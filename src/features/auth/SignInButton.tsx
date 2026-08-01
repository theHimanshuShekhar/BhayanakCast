import { useState, type ReactNode } from 'react'
import { authClient } from './auth-client'

export interface SignInButtonProps {
  ariaLabel?: string
  callbackURL?: string
  className?: string
  icon?: ReactNode
  label?: string
  onActivate?: () => void
}

export function SignInButton({
  ariaLabel,
  callbackURL,
  className,
  icon,
  onActivate,
  label = 'Sign in with Discord',
}: SignInButtonProps) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
    onActivate?.()
    setIsPending(true)
    setError(null)
    try {
      const result = await authClient.signIn.social({
        provider: 'discord',
        callbackURL: safeOAuthCallbackPath(callbackURL),
      })
      if (result.error) setError('Unable to sign in with Discord')
    } catch {
      setError('Unable to sign in with Discord')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="sign-in-control">
      {/* The tooltip repeats the accessible name. Where the rail collapses the
          visible label to the Discord mark alone, the tooltip is the only place
          the full `Continue with Discord` promise still shows. The label lives
          in a span so that collapse is a CSS decision, not a prop. */}
      <button
        aria-busy={isPending}
        aria-label={ariaLabel}
        className={className ?? 'sign-in-button'}
        data-tooltip={ariaLabel ?? label}
        disabled={isPending}
        type="button"
        onClick={signIn}
      >
        {icon}
        <span>{isPending ? 'Opening Discord…' : label}</span>
      </button>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  )
}

export function safeOAuthCallbackPath(value: string | undefined) {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\')
  ) {
    return '/'
  }
  const url = new URL(value, 'http://local')
  if (url.pathname === '/' && url.searchParams.get('intent') === 'create') {
    return '/?intent=create'
  }
  return url.pathname
}
