const EXPIRY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})
import { useState } from 'react'
import { leaveRoom } from './room-queries'
import type { MembershipConfirmation } from '../../server/rooms/room-service'
import type { RoomAdmitted } from './room-types'

interface RoomAdmittedBoundaryProps {
  readonly room: RoomAdmitted
  readonly onLeft: () => void
  readonly onConfirmation: (confirmation: MembershipConfirmation) => void
}

export function RoomAdmittedBoundary({ room, onLeft, onConfirmation }: RoomAdmittedBoundaryProps) {
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
          membershipId: room.membership.id,
        },
      })
      if (result.status === 'left') onLeft()
      else if (result.status === 'confirmation-required') onConfirmation(result.confirmation)
      else setError('You are no longer a member of this room.')
    } catch {
      setError('Unable to leave this room right now.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="room-boundary room-boundary--admitted" data-room-state="admitted">
      <p className="room-boundary__eyebrow">{room.membership.role === 'host' ? 'Host' : 'Member'}</p>
      <h1>{room.name}</h1>
      <dl className="room-boundary__facts">
        <div><dt>Visibility</dt><dd>{room.visibility}</dd></div>
        <div><dt>Members</dt><dd>{room.memberCount} / 10</dd></div>
        <div><dt>Streams</dt><dd>{room.streamCount}</dd></div>
        <div><dt>Expires</dt><dd><time dateTime={room.expiresAt.toISOString()}>{EXPIRY_FORMATTER.format(room.expiresAt)}</time></dd></div>
      </dl>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="room-boundary__actions">
        <a className="room-boundary__back" href="/">Back / Home</a>
        <button aria-busy={pending} disabled={pending} type="button" onClick={leave}>
          {pending ? 'Leaving…' : 'Leave'}
        </button>
      </div>
    </main>
  )
}
