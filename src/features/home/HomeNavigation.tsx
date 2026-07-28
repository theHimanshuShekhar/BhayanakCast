import { useState } from 'react'
import { AccountMenu } from '../auth/AccountMenu'
import { SignInButton } from '../auth/SignInButton'
import type { SessionProjection } from '../auth/auth-client'
import { ThemeToggle } from '../theme/ThemeToggle'

export const CREATE_ROOM_EVENT = 'bhayanakcast:create-room'

export interface CreateRoomControlState {
  readonly pending: boolean
  readonly error: string | null
}

export interface CreateRoomEventDetail {
  readonly setState: (state: CreateRoomControlState) => void
}

interface HomeNavigationProps {
  readonly session: SessionProjection | null
  readonly currentPage?: 'home' | 'profile'
}

export function HomeNavigation({
  session,
  currentPage = 'home',
}: HomeNavigationProps) {
  return (
    <header
      aria-label="BhayanakCast"
      className="home-navigation"
      data-testid="home-navigation"
    >
      <div className="home-top-bar" data-testid="home-top-bar">
        <span aria-label="BhayanakCast" className="home-brand-mark">BC</span>
      </div>

      <nav
        aria-label="Primary"
        className={`home-bottom-navigation${session?.isPlatformAdmin ? ' home-bottom-navigation--admin' : ''}`}
        data-testid="home-bottom-navigation"
      >
        <a
          aria-current={currentPage === 'home' ? 'page' : undefined}
          aria-label="Home"
          className={`home-nav-item${currentPage === 'home' ? ' home-nav-item--current' : ''}`}
          data-tooltip="Home"
          href="/"
        >
          <HomeIcon />
          <span>Home</span>
        </a>
        {session && <CreateRoomButton className="home-nav-item home-nav-item--create" />}
        {session ? (
          <a
            aria-current={currentPage === 'profile' ? 'page' : undefined}
            aria-label="Profile"
            className={`home-nav-item home-nav-item--profile${currentPage === 'profile' ? ' home-nav-item--current' : ''}`}
            data-tooltip="Profile"
            href="/profile"
          >
            <ProfileIcon />
            <span>Profile</span>
          </a>
        ) : (
          <div
            aria-current={currentPage === 'profile' ? 'page' : undefined}
            className={`home-nav-item--profile${currentPage === 'profile' ? ' home-nav-item--current' : ''}`}
          >
            <SignInButton
              ariaLabel="Continue with Discord"
              icon={<DiscordIcon />}
              label="Discord"
            />
          </div>
        )}
        {session?.isPlatformAdmin && (
          <a
            aria-label="Admin"
            className="home-nav-item home-nav-item--admin"
            data-tooltip="Admin"
            href="/admin"
          >
            <AdminIcon />
            <span>Admin</span>
          </a>
        )}
      </nav>

      <ThemeToggle />
      <div className={`home-top-account${session ? '' : ' home-top-account--anonymous'}`}>
        {session ? <AccountMenu session={session} /> : <SignInButton label="Log in" />}
      </div>
    </header>
  )
}

export function CreateRoomButton({
  className,
  label = 'Create',
}: Readonly<{ className?: string; label?: string }>) {
  const [state, setState] = useState<CreateRoomControlState>({
    pending: false,
    error: null,
  })
  const accessibleLabel = state.pending
    ? 'Opening Discord…'
    : label === 'Create'
      ? 'Create room'
      : label
  return (
    <>
      <button
        aria-busy={state.pending || undefined}
        aria-label={accessibleLabel}
        className={className}
        data-tooltip="Create room"
        disabled={state.pending}
        type="button"
        onClick={() => {
          window.dispatchEvent(new CustomEvent<CreateRoomEventDetail>(CREATE_ROOM_EVENT, {
            detail: { setState },
          }))
        }}
      >
        <CreateIcon />
        <span>{state.pending ? 'Opening Discord…' : label}</span>
      </button>
      {state.error && (
        <span className="form-error" role="alert">
          {state.error}
        </span>
      )}
    </>
  )
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z" />
    </svg>
  )
}

function CreateIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function DiscordIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8 8.5a9 9 0 0 1 8 0l1.5 6.5a10 10 0 0 1-3 1.5l-.7-1a8 8 0 0 0 1.2-.6 7 7 0 0 1-6 0 8 8 0 0 0 1.2.6l-.7 1a10 10 0 0 1-3-1.5Z" />
      <circle cx="10" cy="12.5" r="0.8" />
      <circle cx="14" cy="12.5" r="0.8" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" />
    </svg>
  )
}

function AdminIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3 20 6v5c0 5-3.2 8.4-8 10-4.8-1.6-8-5-8-10V6Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}
