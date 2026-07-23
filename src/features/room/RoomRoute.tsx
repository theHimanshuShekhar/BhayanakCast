import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { MembershipConfirmation } from '../../server/rooms/room-service'
import { MembershipConsequencesDialog } from './MembershipConsequencesDialog'
import { PastStreamSummary } from './PastStreamSummary'
import { RoomAdmittedBoundary } from './RoomAdmittedBoundary'
import { RoomNotFound } from './RoomNotFound'
import { RoomPreAdmission } from './RoomPreAdmission'
import { admitRoom, leaveRoom, roomProjectionQueryOptions } from './room-queries'
import type { RoomEnded } from './room-types'
import type { RoomView } from './room-types'

interface RoomRouteProps {
  readonly roomId: string
  readonly initialRoom: RoomView
}

type ConfirmationAction = 'admit' | 'leave'

export function RoomRoute({ roomId, initialRoom }: RoomRouteProps) {
  const roomQuery = useQuery({
    ...roomProjectionQueryOptions(roomId),
    initialData: initialRoom,
  })
  const room = roomQuery.data
  const [confirmation, setConfirmation] = useState<MembershipConfirmation | null>(null)
  const [confirmationAction, setConfirmationAction] = useState<ConfirmationAction | null>(null)
  const [password, setPassword] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [commandPending, setCommandPending] = useState(false)

  if (room.status === 'not-found') return <RoomNotFound />
  if (room.status === 'ended') return <PastStreamSummary room={room as RoomEnded} />
  if (room.status === 'admitted' && room.membership) {
    return (
      <>
        <RoomAdmittedBoundary
          room={room}
          onConfirmation={(next) => {
            setError(null)
            setConfirmationAction('leave')
            setConfirmation(next)
          }}
          onLeft={() => window.location.assign('/')}
        />
        <MembershipConsequencesDialog
          open={confirmationAction === 'leave' && Boolean(confirmation)}
          confirmation={confirmationAction === 'leave' ? confirmation : null}
          pending={roomQuery.isFetching || commandPending}
          error={error}
          onCancel={() => {
            setConfirmation(null)
            setConfirmationAction(null)
          }}
          onConfirm={(next) => void confirmTransition(next)}
        />
        {error && !confirmation && <p className="form-error room-boundary__error" role="alert">{error}</p>}
      </>
    )
  }
  return (
    <>
      <RoomPreAdmission
        authenticated={room.viewerAuthenticated}
        room={room}
        onConfirmation={(next, nextPassword) => {
          setError(null)
          setPassword(nextPassword)
          setConfirmationAction('admit')
          setConfirmation(next)
        }}
        onJoined={() => void roomQuery.refetch()}
        onRefresh={() => roomQuery.refetch()}
      />
      <MembershipConsequencesDialog
        pending={roomQuery.isFetching || commandPending}
        error={error}
        confirmation={confirmationAction === 'admit' ? confirmation : null}
        open={confirmationAction === 'admit' && Boolean(confirmation)}
        onCancel={() => {
          setConfirmation(null)
          setConfirmationAction(null)
        }}
        onConfirm={(next) => void confirmTransition(next)}
      />
      {error && !confirmation && <p className="form-error room-boundary__error" role="alert">{error}</p>}
    </>
  )

  async function confirmTransition(next: MembershipConfirmation) {
    setError(null)
    setCommandPending(true)
    try {
      if (confirmationAction === 'admit') {
        const result = await admitRoom({ data: { roomId, password, confirmation: next } })
        if (result.status === 'joined' || result.status === 'already-member') {
          setConfirmation(null)
          setConfirmationAction(null)
          await roomQuery.refetch()
        } else if (result.status === 'confirmation-required') {
          setConfirmation(result.confirmation)
        } else {
          setConfirmation(null)
          setConfirmationAction(null)
          await roomQuery.refetch()
          setError('The room changed before admission could complete.')
        }
        return
      }
      const result = await leaveRoom({
        data: {
          roomId,
          membershipId: room.status === 'admitted' ? room.membership.id : '',
          confirmation: next,
        },
      })
      if (result.status === 'left') window.location.assign('/')
      else if (result.status === 'confirmation-required') setConfirmation(result.confirmation)
      else {
        setConfirmation(null)
        setConfirmationAction(null)
        await roomQuery.refetch()
        setError('The membership changed before leaving could complete.')
      }
    } catch {
      setError('Unable to complete that room change. Try again.')
    } finally {
      setCommandPending(false)
    }
  }
}
