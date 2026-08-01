import { useState } from 'react'
import { admitRoom } from './room-queries'
import { RoomFact, RoomHeader, RoomSeatStrip, RoomShell } from './RoomShell'
import { authClient } from '../auth/auth-client'
import { safeOAuthCallbackPath } from '../auth/SignInButton'
import { observeRoom } from './room-observability'
import type { MembershipConfirmation } from '../../server/rooms/room-service'
import type { RoomPreAdmission as RoomPreAdmissionView } from './room-types'
import type { SessionProjection } from '../auth/auth-client'

interface RoomPreAdmissionProps {
  readonly room: RoomPreAdmissionView
  readonly session: SessionProjection | null
  readonly onJoined: () => void
  readonly onConfirmation: (confirmation: MembershipConfirmation, password?: string) => void
  readonly onRefresh: () => Promise<unknown>
}
export function RoomPreAdmission({
  room,
  session,
  onJoined,
  onConfirmation,
  onRefresh,
}: RoomPreAdmissionProps) {
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const full = room.admission === 'full'
  const privateRoom = room.visibility === 'private'
  const passwordReady = !privateRoom || !room.viewerAuthenticated || password.length >= 8

  const join = async () => {
    if (full || pending) return
    setError(null)
    setPending(true)
    if (!room.viewerAuthenticated) {
      try {
        observeRouteAction('join', 'oauth_started')
        const result = await authClient.signIn.social({
          provider: 'discord',
          callbackURL: safeOAuthCallbackPath(`/rooms/${encodeURIComponent(room.id)}`),
        })
        if (result.error) setError(result.error.message || 'Unable to open Discord sign-in')
        if (result.error) observeRouteAction('join', 'failed')
      } catch {
        setError('Unable to open Discord sign-in')
        observeRouteAction('join', 'failed')
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
        observeRouteAction('join', 'joined')
        onJoined()
      } else if (result.status === 'confirmation-required') {
        observeRouteAction('join', 'confirmation_required')
        onConfirmation(result.confirmation, room.visibility === 'private' ? password : undefined)
      } else {
        observeRouteAction('join', 'rejected')
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
      observeRouteAction('join', 'failed')
      setError('Unable to join this room right now.')
    } finally {
      setPending(false)
    }
  }

  return (
    <RoomShell session={session} state="pre-admission">
      <section
        className="room-boundary room-boundary--pre-admission"
        data-room-state="pre-admission"
      >
        <RoomHeader
          category={room.category}
          description={room.description}
          eyebrow={room.visibility === 'private' ? 'Private Room' : 'Public Room'}
          eyebrowTone={room.visibility === 'private' ? 'neutral' : 'live'}
          facts={
            <>
              <RoomFact tone="live">Live</RoomFact>
              <RoomFact tone={room.streamCount > 0 ? 'live' : 'neutral'}>
                {room.streamCount}{' '}
                {room.streamCount === 1 ? 'screen shared' : 'screens shared'}
              </RoomFact>
              <RoomFact tone={full ? 'warning' : 'neutral'}>
                {room.memberCount} of {room.capacity} here
              </RoomFact>
              {full && <RoomFact tone="warning">Full</RoomFact>}
            </>
          }
          name={room.name}
          tags={room.tags}
        />

        <div className="room-stage">
          <div className="room-spotlight" data-spotlight="gated">
            <p className="room-spotlight__state">
              {full ? 'This room is full.' : 'Join when you are ready.'}
            </p>
            <p className="room-spotlight__note">
              {full
                ? 'All seats are taken. Browse another room or check back later.'
                : privateRoom
                  ? room.viewerAuthenticated
                    ? 'Enter the room password below. Admission happens only after you choose Join.'
                    : 'Choose Join to continue with Discord, then return here to enter the room password.'
                  : room.viewerAuthenticated
                    ? 'Opening this link did not join you. Admission happens only after you choose Join.'
                    : 'Choose Join to continue with Discord. You will return here before admission.'}
            </p>
          </div>

          <section aria-label="Seats" className="room-stage__seats">
            <h2 className="visually-hidden">Seats</h2>
            <RoomSeatStrip capacity={room.capacity} memberCount={room.memberCount} />
            <p className="room-stage__seats-label tabular-nums">
              {room.memberCount} of {room.capacity} seats taken
            </p>
          </section>

          {room.viewerAuthenticated && privateRoom && !full && (
            <label className="room-boundary__password">
              Password (at least 8 characters)
              <input
                autoComplete="current-password"
                minLength={8}
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="room-controls">
            <a
              className="room-boundary__back"
              href="/"
              onClick={() => observeRouteAction('back_home', 'navigated')}
            >
              Back / Home
            </a>
            <button
              aria-busy={pending}
              disabled={pending || full || !passwordReady}
              type="button"
              onClick={join}
            >
              {full
                ? 'Full'
                : pending
                  ? room.viewerAuthenticated
                    ? 'Joining…'
                    : 'Opening Discord…'
                  : 'Join'}
            </button>
          </div>
        </div>
      </section>
    </RoomShell>
  )
}

function observeRouteAction(
  action: 'join' | 'back_home',
  outcome:
    | 'joined'
    | 'confirmation_required'
    | 'oauth_started'
    | 'rejected'
    | 'failed'
    | 'navigated',
) {
  observeRoom({
    name: 'room_route_action',
    properties: { state: 'pre_admission', action, outcome },
  })
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
