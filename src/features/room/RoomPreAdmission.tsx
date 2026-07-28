import { useState } from 'react'
import { admitRoom } from './room-queries'
import { RoomFact, RoomHeader, RoomSeatStrip, RoomShell } from './RoomShell'
import { authClient } from '../auth/auth-client'
import { safeOAuthCallbackPath } from '../auth/SignInButton'
import type { MembershipConfirmation } from '../../server/rooms/room-service'
import type { RoomPreAdmission as RoomPreAdmissionView } from './room-types'

interface RoomPreAdmissionProps {
  readonly room: RoomPreAdmissionView
  readonly onJoined: () => void
  readonly onConfirmation: (confirmation: MembershipConfirmation, password?: string) => void
  readonly onRefresh: () => Promise<unknown>
}
export function RoomPreAdmission({
  room,
  onJoined,
  onConfirmation,
  onRefresh,
}: RoomPreAdmissionProps) {
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const full = room.admission === 'full'

  const join = async () => {
    if (full || pending) return
    setError(null)
    setPending(true)
    if (!room.viewerAuthenticated) {
      try {
        const result = await authClient.signIn.social({
          provider: 'discord',
          callbackURL: safeOAuthCallbackPath(`/rooms/${encodeURIComponent(room.id)}`),
        })
        if (result.error) setError(result.error.message || 'Unable to open Discord sign-in')
      } catch {
        setError('Unable to open Discord sign-in')
      } finally {
        setPending(false)
      }
      return
    }
    try {
      const result = await admitRoom({
        data: {
          roomId: room.id,
          password: room.visibility === 'private' ? password : undefined,
        },
      })
      if (result.status === 'joined' || result.status === 'already-member') {
        onJoined()
      } else if (result.status === 'confirmation-required') {
        onConfirmation(result.confirmation, room.visibility === 'private' ? password : undefined)
      } else {
        if (
          result.status === 'password-required' ||
          result.status === 'full' ||
          result.status === 'ended' ||
          result.status === 'not-found'
        ) {
          await onRefresh()
        }
        setError(admissionError(result.status))
      }
    } catch {
      setError('Unable to join this room right now.')
    } finally {
      setPending(false)
    }
  }

  return (
    <RoomShell state="pre-admission">
      <section
        className="room-boundary room-boundary--pre-admission"
        data-room-state="pre-admission"
      >
        <RoomHeader
          category={room.category}
          eyebrow={room.visibility === 'private' ? 'Private Room' : 'Public Room'}
          eyebrowTone={room.visibility === 'private' ? 'neutral' : 'live'}
          facts={
            <>
              <RoomFact tone={room.streamCount > 0 ? 'live' : 'neutral'}>
                {room.streamCount}{' '}
                {room.streamCount === 1 ? 'screen shared' : 'screens shared'}
              </RoomFact>
              <RoomFact tone={full ? 'warning' : 'neutral'}>
                {room.memberCount} of {room.capacity} here
              </RoomFact>
            </>
          }
          name={room.name}
          tags={room.tags}
        />

        <div className="room-stage">
          <div className="room-spotlight" data-spotlight="gated">
            <p className="room-spotlight__state">
              {full
                ? 'This room is full.'
                : 'You are not in this room yet.'}
            </p>
            <p className="room-spotlight__note">
              Join explicitly to enter. Opening this link does not join you.
            </p>
          </div>

          <section aria-label="Seats" className="room-stage__seats">
            <h2 className="visually-hidden">Seats</h2>
            <RoomSeatStrip capacity={room.capacity} memberCount={room.memberCount} />
            <p className="room-stage__seats-label tabular-nums">
              {room.memberCount} of {room.capacity} seats taken
            </p>
          </section>

          {room.viewerAuthenticated && room.visibility === 'private' && !full && (
            <label className="room-boundary__password">
              Password
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="room-controls">
            <a className="room-boundary__back" href="/">Back / Home</a>
            <button
              aria-busy={pending}
              className="room-controls__join"
              disabled={pending || full}
              type="button"
              onClick={join}
            >
              {full
                ? 'Full'
                : pending
                  ? room.viewerAuthenticated
                    ? 'Joining…'
                    : 'Opening Discord…'
                  : room.viewerAuthenticated
                    ? 'Join'
                    : 'Sign in to join'}
            </button>
          </div>
        </div>
      </section>
    </RoomShell>
  )
}

function admissionError(status: string) {
  const errors: Record<string, string> = {
    'password-required': 'Enter the private room password.',
    'invalid-password': 'That password is not correct.',
    full: 'This room is full.',
    ended: 'This room has ended.',
    banned: 'You cannot join this room.',
    'account-read-only': 'This account cannot join rooms right now.',
    'all-access-sanctioned': 'This account cannot join rooms right now.',
    'rate-limited': 'Joining is temporarily rate limited.',
    'rate-limit-unavailable': 'Joining is temporarily unavailable.',
    'not-found': 'This room is no longer available.',
  }
  return errors[status] ?? 'Unable to join this room.'
}
