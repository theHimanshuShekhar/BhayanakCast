import type { ReactNode } from 'react'
import { HomeNavigation } from '../home/HomeNavigation'
import type { SessionProjection } from '../auth/auth-client'

/** Rail Spotlight. The 72px icon rail carries over from Home so moving into a
    room does not feel like a different product; everything to its right is the
    room itself. */
export function RoomShell({
  children,
  session = null,
  state,
}: Readonly<{
  children: ReactNode
  session?: SessionProjection | null
  state: 'admitted' | 'pre-admission' | 'ended' | 'not-found'
}>) {
  return (
    <div className="room-shell" data-room-shell={state}>
      <HomeNavigation session={session} />
      {children}
    </div>
  )
}

export function RoomHeader({
  eyebrow,
  eyebrowTone = 'neutral',
  name,
  category,
  tags,
  facts,
}: Readonly<{
  eyebrow: string
  eyebrowTone?: 'host' | 'live' | 'neutral'
  name: string
  category: string | null
  tags: readonly string[]
  facts: ReactNode
}>) {
  return (
    <header className="room-header">
      <div className="room-header__identity">
        <p className={`room-header__eyebrow room-header__eyebrow--${eyebrowTone}`}>
          {eyebrow}
        </p>
        <h1 data-room-primary-heading="" tabIndex={-1}>
          {name}
        </h1>
        {category && <p className="room-header__category">{category}</p>}
        {tags.length > 0 && (
          <div className="room-header__tags">
            {tags.map((tag) => (
              <span className="room-chip" key={tag}>#{tag}</span>
            ))}
          </div>
        )}
      </div>
      <div className="room-header__facts">{facts}</div>
    </header>
  )
}

export function RoomFact({
  children,
  tone = 'neutral',
}: Readonly<{ children: ReactNode; tone?: 'live' | 'warning' | 'neutral' }>) {
  return <span className={`room-fact room-fact--${tone}`}>{children}</span>
}

/** Seats, not people. The room projection knows how many seats are taken but
    carries no roster, so the strip shows occupancy honestly rather than
    inventing names for the tiles the design fills with members. */
export function RoomSeatStrip({
  memberCount,
  capacity,
}: Readonly<{ memberCount: number; capacity: number }>) {
  const taken = Math.min(memberCount, capacity)
  return (
    <div
      aria-label={`${taken} of ${capacity} seats taken`}
      className="room-seats"
      data-testid="room-seats"
    >
      {Array.from({ length: capacity }, (_, index) => (
        <span
          className="room-seats__seat"
          data-taken={index < taken}
          key={index}
        />
      ))}
    </div>
  )
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'always' })

/** Coarse on purpose: the exact second a room expires is noise, and a ticking
    clock would re-render the whole spotlight every second. */
export function expiresInLabel(expiresAt: Date, now = Date.now()) {
  const minutes = Math.round((expiresAt.getTime() - now) / 60_000)
  if (minutes <= 0) return 'expiring now'
  if (minutes < 60) return `expires ${RELATIVE.format(minutes, 'minute')}`
  return `expires ${RELATIVE.format(Math.round(minutes / 60), 'hour')}`
}
