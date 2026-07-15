import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { authClient, type SessionProjection } from './auth-client'

export interface AccountMenuProps {
  session: SessionProjection
}

export function AccountMenu({ session }: AccountMenuProps) {
  const menuId = `account-menu-${useId().replaceAll(':', '')}`
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    popoverRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const dismissOnPointer = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        !popoverRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setIsOpen(false)
      }
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOnPointer)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointer)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [isOpen])

  const signOut = async () => {
    setIsPending(true)
    setError(null)
    try {
      const result = await authClient.signOut()
      if (result.error) {
        setError(result.error.message ?? 'Unable to log out')
      } else {
        setIsOpen(false)
        window.location.assign('/')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to log out')
    } finally {
      setIsPending(false)
    }
  }

  const moveMenuFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...(popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <section aria-label="Account" className="account-menu">
      <button
        ref={triggerRef}
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`${session.displayName} account`}
        className="account-menu__trigger"
        data-tooltip="Account"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
      >
        {session.avatar ? (
          <img
            alt=""
            height="36"
            src={session.avatar}
            width="36"
          />
        ) : (
          <span aria-hidden="true" className="account-menu__fallback">
            {session.displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="account-menu__identity">
          <strong>{session.displayName}</strong>
          {session.isPlatformAdmin && <small>Platform administrator</small>}
        </span>
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          className="account-menu__popover"
          id={menuId}
          role="menu"
          onKeyDown={moveMenuFocus}
          onBlur={(event) => {
            if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) {
              setIsOpen(false)
            }
          }}
        >
          <a href="/profile" role="menuitem">Profile</a>
          <button
            aria-busy={isPending}
            disabled={isPending}
            role="menuitem"
            type="button"
            onClick={signOut}
          >
            {isPending ? 'Logging out…' : 'Log out'}
          </button>
          {error && <p className="auth-error" role="alert">{error}</p>}
        </div>
      )}
    </section>
  )
}
