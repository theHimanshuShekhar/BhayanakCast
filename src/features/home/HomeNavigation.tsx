import type { QueryKey } from '@tanstack/react-query'
import { AccountMenu } from '../auth/AccountMenu'
import { SignInButton } from '../auth/SignInButton'
import type { SessionProjection } from '../auth/auth-client'
import { ThemeToggle } from '../theme/ThemeToggle'
import { HomeSectionBoundary } from './HomeSectionBoundary'
import { HomeMetricsSkeleton } from './HomeSectionSkeletons'
import type { ConnectedPresence } from './home-types'

export const CREATE_ROOM_EVENT = 'bhayanakcast:create-room'

interface HomeNavigationProps {
  readonly session: SessionProjection | null
  readonly presence: ConnectedPresence | undefined
  readonly presencePending: boolean
  readonly presenceFailed: boolean
  readonly presenceQueryKey: QueryKey
}

export function HomeNavigation({
  session,
  presence,
  presencePending,
  presenceFailed,
  presenceQueryKey,
}: HomeNavigationProps) {
  return (
    <header
      aria-label="BhayanakCast"
      className="home-navigation"
      data-testid="home-navigation"
    >
      <div className="home-top-bar" data-testid="home-top-bar">
        <span aria-label="BhayanakCast" className="home-brand-mark">B</span>
        <HomeSectionBoundary
          failed={presenceFailed}
          label="Connected presence"
          pending={presencePending && !presence}
          queryKey={presenceQueryKey}
          skeleton={<HomeMetricsSkeleton label="Loading connected presence" />}
        >
          <section aria-label="Connected presence" className="home-presence">
            <h2>Connected presence</h2>
            <span aria-hidden="true" className="home-presence__dot" />
            <span className="tabular-nums">
              {presence?.connectedAccountCount ?? '—'}{' '}
              <span className="home-presence__label">accounts connected</span>
            </span>
          </section>
        </HomeSectionBoundary>
      </div>

      <nav
        aria-label="Primary"
        className={`home-bottom-navigation${session?.isPlatformAdmin ? ' home-bottom-navigation--admin' : ''}`}
        data-testid="home-bottom-navigation"
      >
        <a
          aria-current="page"
          aria-label="Home"
          className="home-nav-item home-nav-item--current"
          data-tooltip="Home"
          href="/"
        >
          <HomeIcon />
          <span>Home</span>
        </a>
        <CreateRoomButton className="home-nav-item home-nav-item--create" />
        {session ? (
          <a
            aria-label="Profile"
            className="home-nav-item home-nav-item--profile"
            data-tooltip="Profile"
            href="/profile"
          >
            <ProfileIcon />
            <span>Profile</span>
          </a>
        ) : (
          <div className="home-nav-item--profile">
            <SignInButton ariaLabel="Profile — sign in with Discord" label="Profile" />
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
  return (
    <button
      aria-label={label === 'Create' ? 'Create room' : label}
      className={className}
      data-tooltip="Create room"
      type="button"
      onClick={() => window.dispatchEvent(new Event(CREATE_ROOM_EVENT))}
    >
      <CreateIcon />
      <span>{label}</span>
    </button>
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
