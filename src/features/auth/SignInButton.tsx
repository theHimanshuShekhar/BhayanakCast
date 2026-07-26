import { useState, type ReactNode } from 'react'
import { authClient } from './auth-client'

export interface SignInButtonProps {
  ariaLabel?: string
  callbackURL?: string
  className?: string
  icon?: ReactNode
  label?: string
}

export function SignInButton({
  ariaLabel,
  callbackURL,
  className,
  icon,
  label = 'Sign in with Discord',
}: SignInButtonProps) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
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
      <button
        aria-busy={isPending}
        aria-label={ariaLabel ?? (label === 'Log in' ? 'Sign in with Discord' : undefined)}
        className={className ?? 'sign-in-button'}
        data-tooltip={label === 'Log in' ? 'Sign in with Discord' : label}
        disabled={isPending}
        type="button"
        onClick={signIn}
      >
        {icon}
        {isPending ? 'Opening Discord…' : label}
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
