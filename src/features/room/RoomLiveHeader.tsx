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
  const dismissDetails = useCallback((reason: 'control' | 'escape') => {
    setDetailsOpen(false)
    setDetailsExpanded(false)
    observeRoom({ name: 'room_details_closed', properties: { reason } })
    requestAnimationFrame(() => detailsButton.current?.focus())
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!detailsOpen) return
    detailsClose.current?.focus()
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
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
    >
      {roomCountdownLabel(room.expiresAt, now)}
    </time>
  )

  return (
    <header className="room-header room-live-header">
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
        <span className="room-live-header__privacy">
          {room.visibility === 'private' ? 'Private' : 'Public'}
        </span>
        <span className="room-live-header__live-state">
          {room.memberCount >= room.capacity ? 'Full' : 'Live'}
        </span>
        <span className="room-live-header__mobile-countdown">{countdown}</span>
        {canManageSettings && (
          <button
            className="room-live-header__settings"
            type="button"
            onClick={() => openSettings('desktop')}
          >
            Settings
          </button>
        )}
        <button
          aria-controls="room-details"
          aria-expanded={detailsOpen}
          className="room-live-header__details-trigger"
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
          {room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}
        </span>
        <span className="room-live-header__fact">
          {room.streamCount} {room.streamCount === 1 ? 'Stream' : 'Streams'}
        </span>
        {countdown}
      </div>

      {detailsOpen && (
        <aside
          aria-label="Room details"
          className="room-details"
          data-height={detailsExpanded ? '90' : '55'}
          id="room-details"
        >
          <div className="room-details__controls">
            <button
              aria-label={detailsExpanded ? 'Collapse Details to 55%' : 'Expand Details to 90%'}
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
          <div className="room-details__content">
            <p className="room-details__eyebrow">Room details</p>
            <h2>{room.name}</h2>
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
              <button type="button" onClick={() => openSettings('details')}>
                Settings
              </button>
            )}
          </div>
        </aside>
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
  if (!room.category && room.tags.length === 0 && (!room.description || expanded)) {
    return expanded ? <p className="room-details__empty">No category or tags</p> : null
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
  if (!host) return <span>Unavailable</span>
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
