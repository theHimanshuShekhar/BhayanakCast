import { useState } from 'react'
import { leaveRoom } from './room-queries'
import {
  RoomFact,
  RoomHeader,
  RoomSeatStrip,
  RoomShell,
  expiresInLabel,
} from './RoomShell'
import type { MembershipConfirmation } from '../../server/rooms/room-service'
import type { RoomAdmitted, RoomSelfMembership } from './room-types'

const EXPIRY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

interface RoomAdmittedBoundaryProps {
  readonly room: RoomAdmitted
  readonly self: RoomSelfMembership
  readonly onLeft: (roomState: 'active' | 'empty-grace' | 'ended') => void
  readonly onConfirmation: (confirmation: MembershipConfirmation) => void
}

export function RoomAdmittedBoundary({
  room,
  self,
  onLeft,
  onConfirmation,
}: RoomAdmittedBoundaryProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const leave = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await leaveRoom({
        data: {
          roomId: room.id,
          membershipId: self.id,
        },
      })
      if (result.status === 'left') onLeft(result.roomState)
      else if (result.status === 'confirmation-required') onConfirmation(result.confirmation)
      else setError('You are no longer a member of this room.')
    } catch {
      setError('Unable to leave this room right now.')
    } finally {
      setPending(false)
    }
  }

  return (
    <RoomShell state="admitted">
      <main className="room-boundary room-boundary--admitted" data-room-state="admitted">
        <RoomHeader
          category={room.category}
          eyebrow={self.role === 'host' ? 'Host' : 'Member'}
          eyebrowTone={self.role === 'host' ? 'host' : 'neutral'}
          facts={
            <>
              <RoomFact tone={room.streamCount > 0 ? 'live' : 'neutral'}>
                {room.streamCount}{' '}
                {room.streamCount === 1 ? 'screen shared' : 'screens shared'}
              </RoomFact>
              <RoomFact>
                {room.memberCount} of {room.capacity} here
              </RoomFact>
              <RoomFact tone="warning">
                <time dateTime={room.expiresAt.toISOString()}>
                  {expiresInLabel(room.expiresAt)}
                </time>
              </RoomFact>
            </>
          }
          name={room.name}
          tags={room.tags}
        />

        <div className="room-stage">
          <div
            className="room-spotlight"
            data-spotlight={room.streamCount > 0 ? 'available' : 'quiet'}
          >
            <p className="room-spotlight__state">
              {room.streamCount > 0
                ? `${room.streamCount} ${room.streamCount === 1 ? 'screen is' : 'screens are'} being shared in this room.`
                : 'Nobody is sharing a screen yet.'}
            </p>
            <p className="room-spotlight__note">
              Watching and sharing are not wired up yet — this room tracks who is
              in it and how many screens are up.
            </p>
          </div>

          <section aria-label="Seats" className="room-stage__seats">
            <h2 className="visually-hidden">Seats</h2>
            <RoomSeatStrip capacity={room.capacity} memberCount={room.memberCount} />
            <p className="room-stage__seats-label tabular-nums">
              {room.memberCount} of {room.capacity} seats taken
            </p>
          </section>

          {error && (
            <p className="form-error room-boundary__error" role="alert">
              {error}
            </p>
          )}

          <div className="room-controls">
            <a className="room-boundary__back" href="/">
              Back to Home
            </a>
            <button
              aria-busy={pending}
              className="room-controls__leave"
              disabled={pending}
              type="button"
              onClick={leave}
            >
              {pending ? 'Leaving…' : 'Leave'}
            </button>
          </div>
        </div>

        <aside aria-label="Room details" className="room-panel">
          <h2>Room details</h2>
          <dl className="room-panel__facts">
            <div>
              <dt>Visibility</dt>
              <dd>{room.visibility === 'private' ? 'Private' : 'Public'}</dd>
            </div>
            <div>
              <dt>Your role</dt>
              <dd>{self.role === 'host' ? 'Host' : 'Member'}</dd>
            </div>
            <div>
              <dt>Members</dt>
              <dd className="tabular-nums">
                {room.memberCount} / {room.capacity}
              </dd>
            </div>
            <div>
              <dt>Streams</dt>
              <dd className="tabular-nums">{room.streamCount}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>
                <time dateTime={room.expiresAt.toISOString()}>
                  {EXPIRY_FORMATTER.format(room.expiresAt)} UTC
                </time>
              </dd>
            </div>
          </dl>
        </aside>
      </main>
    </RoomShell>
  )
}
