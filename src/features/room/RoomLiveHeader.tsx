import { useCallback, useEffect, useRef, useState } from 'react'
import type { RoomRosterMember } from '../../server/rooms/room-roster'
import type { RoomAdmitted } from './room-types'
import { observeRoom } from './room-observability'
import {
  roomCountdownLabel,
  roomCountdownState,
} from './room-countdown'

interface RoomLiveHeaderProps {
  readonly room: RoomAdmitted
  readonly canManageSettings: boolean
  readonly onOpenSettings: () => void
}

export function RoomLiveHeader({
  room,
  canManageSettings,
  onOpenSettings,
}: RoomLiveHeaderProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const detailsButton = useRef<HTMLButtonElement | null>(null)
  const detailsClose = useRef<HTMLButtonElement | null>(null)
  const host = room.roster.find((member) => member.role === 'host') ?? null
  const countdownState = roomCountdownState(room.expiresAt, now)
  const dismissDetails = useCallback((reason: 'control' | 'escape' | 'backdrop') => {
    setDetailsOpen(false)
    setDetailsExpanded(false)
    observeRoom({ name: 'room_details_closed', properties: { reason } })
    requestAnimationFrame(() => detailsButton.current?.focus())
  }, [])

  useEffect(() => {
    // Above two minutes the label only changes once a minute, so the 30s
    // cadence that keeps the shell from re-rendering all day is enough. Inside
    // it the warning ladder has to land on its own boundary, not up to 30
    // seconds late, so ADR 0075's one-minute warning stays a minute long.
    const delay = room.expiresAt.getTime() - now > 120_000 ? 30_000 : 1_000
    const timer = window.setTimeout(() => setNow(Date.now()), delay)
    return () => window.clearTimeout(timer)
  }, [now, room.expiresAt])

  useEffect(() => {
    if (!detailsOpen) return
    detailsClose.current?.focus()
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      dismissDetails('escape')
    }
    document.addEventListener('keydown', dismissOnEscape)
    return () => document.removeEventListener('keydown', dismissOnEscape)
  }, [detailsOpen, dismissDetails])

  const countdown = (
    <time
      aria-label={roomCountdownLabel(room.expiresAt, now, true)}
      className="room-live-header__countdown"
      data-countdown-state={countdownState}
      dateTime={room.expiresAt.toISOString()}
      suppressHydrationWarning
    >
      {roomCountdownLabel(room.expiresAt, now)}
    </time>
  )

  return (
    <header className="room-live-header">
      <div className="room-live-header__primary">
        <a
          className="room-live-header__back"
          href="/"
          onClick={() =>
            observeHeaderAction(
              'back_home',
              window.matchMedia('(max-width: 47.999rem)').matches ? 'mobile' : 'desktop',
            )
          }
        >
          <span className="room-live-header__back-wide">Back / Home</span>
          <span className="room-live-header__back-compact">Back</span>
        </a>
        <h1 data-room-primary-heading="" tabIndex={-1} title={room.name}>
          {room.name}
        </h1>
        <span className="room-live-header__state">
          <span
            className={`room-chip room-chip--${room.visibility === 'private' ? 'private' : 'public'}`}
          >
            {room.visibility === 'private' ? 'Private' : 'Public'}
          </span>
          <span className="room-chip room-chip--live">Live</span>
          {room.memberCount >= room.capacity && (
            <span className="room-chip room-chip--full">Full</span>
          )}
        </span>
        <span className="room-live-header__mobile-countdown">{countdown}</span>
        {canManageSettings && (
          <button
            className="room-live-header__settings room-button--quiet"
            type="button"
            onClick={() => openSettings('desktop')}
          >
            Settings
          </button>
        )}
        <button
          aria-controls="room-details"
          aria-expanded={detailsOpen}
          className="room-live-header__details-trigger room-button--quiet"
          ref={detailsButton}
          type="button"
          onClick={openDetails}
        >
          Details
        </button>
      </div>

      <div className="room-live-header__secondary">
        <RoomMetadata room={room} />
        <HostFact host={host} />
        <span className="room-live-header__fact">
          {room.memberCount} of {room.capacity} members
        </span>
        <span className="room-live-header__fact">
          {room.streamCount} {room.streamCount === 1 ? 'Stream' : 'Streams'}
        </span>
        {countdown}
      </div>

      {detailsOpen && (
        <>
          <button
            aria-label="Close Room details"
            className="room-details__backdrop"
            tabIndex={-1}
            type="button"
            onClick={() => dismissDetails('backdrop')}
          />
          <aside
            aria-labelledby="room-details-title"
            className="room-details"
            data-height={detailsExpanded ? '90' : '55'}
            id="room-details"
          >
            <div className="room-details__controls">
              <h2 id="room-details-title">Room details</h2>
              <div className="room-details__buttons">
                <button
                  aria-label={
                    detailsExpanded ? 'Collapse Details to 55%' : 'Expand Details to 90%'
                  }
                  className="room-button--quiet"
                  type="button"
                  onClick={toggleDetailsHeight}
                >
                  {detailsExpanded ? 'Collapse' : 'Expand'}
                </button>
                <button
                  ref={detailsClose}
                  type="button"
                  onClick={() => dismissDetails('control')}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="room-details__content">
              {room.description && <p>{room.description}</p>}
              <RoomMetadata room={room} expanded />
              <dl className="room-details__facts">
                <div>
                  <dt>Host</dt>
                  <dd><HostIdentity host={host} /></dd>
                </div>
                <div>
                  <dt>Members</dt>
                  <dd>{room.memberCount} of {room.capacity}</dd>
                </div>
                <div>
                  <dt>Streams</dt>
                  <dd>{room.streamCount}</dd>
                </div>
                <div>
                  <dt>Room lifetime</dt>
                  <dd>{countdown}</dd>
                </div>
              </dl>
              {canManageSettings && (
                <button
                  className="room-button--quiet"
                  type="button"
                  onClick={() => openSettings('details')}
                >
                  Settings
                </button>
              )}
            </div>
          </aside>
        </>
      )}
    </header>
  )

  function openDetails() {
    setDetailsOpen(true)
    observeHeaderAction('details', 'mobile')
  }


  function toggleDetailsHeight() {
    const next = !detailsExpanded
    setDetailsExpanded(next)
    observeRoom({
      name: 'room_details_resized',
      properties: { height: next ? '90' : '55' },
    })
  }

  function openSettings(surface: 'desktop' | 'details') {
    observeHeaderAction('settings', surface)
    onOpenSettings()
  }
}

function RoomMetadata({
  room,
  expanded = false,
}: Readonly<{ room: RoomAdmitted; expanded?: boolean }>) {
  // The slot is always rendered: dropping it would hand the flexible column to
  // the Host fact and move the countdown, so the deadline would sit in a
  // different place depending on whether anyone tagged the room.
  if (expanded && !room.category && room.tags.length === 0) {
    return <p className="room-details__empty">No category or tags</p>
  }
  return (
    <div className={expanded ? 'room-details__metadata' : 'room-live-header__metadata'}>
      {!expanded && room.description && (
        <span className="room-live-header__description">{room.description}</span>
      )}
      {room.category && <span className="room-live-header__category">{room.category}</span>}
      {room.tags.length > 0 && (
        <span className="room-live-header__tags" aria-label="Room tags">
          {room.tags.map((tag) => <span className="room-chip" key={tag}>#{tag}</span>)}
        </span>
      )}
    </div>
  )
}

function HostFact({ host }: Readonly<{ host: RoomRosterMember | null }>) {
  return (
    <span className="room-live-header__fact room-live-header__host">
      <span>Host</span>
      <HostIdentity host={host} />
    </span>
  )
}

function HostIdentity({ host }: Readonly<{ host: RoomRosterMember | null }>) {
  if (!host) return <span className="room-live-header__host-absent">Transferring…</span>
  return (
    <span className="room-live-header__host-identity">
      {host.avatarUrl && <img alt="" src={host.avatarUrl} />}
      <span>{host.displayName}</span>
    </span>
  )
}

function observeHeaderAction(
  action: 'back_home' | 'details' | 'settings',
  surface: 'desktop' | 'mobile' | 'details',
) {
  observeRoom({ name: 'room_header_action', properties: { action, surface } })
}
