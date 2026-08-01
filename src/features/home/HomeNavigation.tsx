import { useState } from 'react'
import { SiDiscord } from '@icons-pack/react-simple-icons'
import { House, Plus, ShieldCheck, UserRound } from 'lucide-react'
import { AccountMenu } from '../auth/AccountMenu'
import { SignInButton } from '../auth/SignInButton'
import type { SessionProjection } from '../auth/auth-client'
import { ThemeToggle } from '../theme/ThemeToggle'
import { observeHome } from './home-observability'

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
              onActivate={() => observeHome({
                name: 'home_discord_sign_in_started',
                properties: { intent: 'home' },
              })}
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
      {/* Anonymous visitors get exactly one dedicated sign-in door, the
          `Discord` control in the navigation above. A second one here was a
          duplicate top-bar authentication control the product forbids, and it
          rendered with its label collapsed to zero width anyway. */}
      {session && (
        <div className="home-top-account">
          <AccountMenu session={session} />
        </div>
      )}
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
          observeHome({ name: 'home_create_started', properties: {} })
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

/* Lucide for the interface glyphs — same 24-unit grid and round line ends the
   hand-drawn set was imitating, minus the imitating. Sizing and stroke width
   stay with the rail's CSS, so one rule still governs every icon in it. */
function HomeIcon() {
  return <House aria-hidden="true" />
}

function CreateIcon() {
  return <Plus aria-hidden="true" />
}

/* A logo is not a line icon: Discord's mark is a filled shape from Simple
   Icons, drawn to the brand's own outline instead of an approximation of it.
   The rail's `.sign-in-button svg` rule is what fills rather than strokes it. */
function DiscordIcon() {
  // Empty title: the pack ships a `<title>Discord</title>` inside the mark, and
  // next to the control's own `Discord` label that is the word twice — once in
  // the button's text, once again from an element that is aria-hidden anyway.
  return <SiDiscord aria-hidden="true" title="" />
}

function ProfileIcon() {
  return <UserRound aria-hidden="true" />
}

function AdminIcon() {
  return <ShieldCheck aria-hidden="true" />
}
