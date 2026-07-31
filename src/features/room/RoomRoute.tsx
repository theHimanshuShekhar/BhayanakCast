import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import type { MembershipConfirmation } from '../../server/rooms/room-service'
import {
  HOME_ACCOUNT_REVOKED_EVENT,
  HOME_ACCOUNT_REPLACED_EVENT,
  HOME_SOCKET_EVENT,
} from '../../server/realtime/home-events'
import { projectDisplacedRoom } from '../../server/rooms/room-projection'
import { MembershipConsequencesDialog } from './MembershipConsequencesDialog'
import { PastStreamSummary } from './PastStreamSummary'
import { RoomAdmittedBoundary } from './RoomAdmittedBoundary'
import { RoomNotFound } from './RoomNotFound'
import { RoomPreAdmission } from './RoomPreAdmission'
import {
  admitRoom,
  applyRoomProjectionRealtimeEvent,
  invalidateRoomProjection,
  leaveRoom,
  roomProjectionQueryOptions,
} from './room-queries'
import type { RoomSocket } from './useRoomRealtime'
import type { RoomView } from './room-types'
import type { SessionProjection } from '../auth/auth-client'

interface RoomRouteProps {
  readonly roomId: string
  readonly initialRoom: RoomView
  /** The rail needs it in every boundary, so every boundary is handed it here
      rather than defaulting to anonymous when a caller forgets. */
  readonly session: SessionProjection | null
}

type ConfirmationAction = 'admit' | 'leave'
interface RoomProjectionSocket {
  readonly io: { readonly opts: { reconnection?: boolean } }
  on(event: string, handler: (value?: unknown) => void): unknown
  off(event: string, handler: (value?: unknown) => void): unknown
  disconnect(): unknown
}

interface RoomProjectionSocketHandlers {
  readonly onRefresh: () => void
  readonly onRoomEvent: (value: unknown) => void
  readonly onTerminal: () => void
  readonly onReplacement: () => void
}

export function bindRoomProjectionSocket(
  socket: RoomProjectionSocket,
  handlers: RoomProjectionSocketHandlers,
): () => void {
  const onConnect = () => handlers.onRefresh()
  const onRevoked = () => {
    socket.io.opts.reconnection = false
    handlers.onTerminal()
    handlers.onRefresh()
    socket.disconnect()
  }
  const onReplaced = () => {
    socket.io.opts.reconnection = false
    handlers.onTerminal()
    handlers.onReplacement()
    socket.disconnect()
  }
  socket.on('connect', onConnect)
  socket.on(HOME_SOCKET_EVENT, handlers.onRoomEvent)
  socket.on(HOME_ACCOUNT_REVOKED_EVENT, onRevoked)
  socket.on(HOME_ACCOUNT_REPLACED_EVENT, onReplaced)
  return () => {
    socket.off('connect', onConnect)
    socket.off(HOME_SOCKET_EVENT, handlers.onRoomEvent)
    socket.off(HOME_ACCOUNT_REVOKED_EVENT, onRevoked)
    socket.off(HOME_ACCOUNT_REPLACED_EVENT, onReplaced)
    socket.disconnect()
  }
}

export function focusRoomPrimaryHeading(
  root: Pick<Document, 'querySelector'> = document,
): void {
  const heading = root.querySelector('[data-room-primary-heading]') as HTMLElement | null
  heading?.focus()
}


export function RoomRoute({ roomId, initialRoom, session }: RoomRouteProps) {
  const queryClient = useQueryClient()
  const roomQuery = useQuery({
    ...roomProjectionQueryOptions(roomId),
    initialData: initialRoom,
  })
  const canonicalProjection = roomQuery.data
  const [confirmation, setConfirmation] = useState<MembershipConfirmation | null>(null)
  const [confirmationAction, setConfirmationAction] = useState<ConfirmationAction | null>(null)
  const [password, setPassword] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [commandPending, setCommandPending] = useState(false)
  const [replacedRoomId, setReplacedRoomId] = useState<string | null>(null)
  const [roomSocket, setRoomSocket] = useState<RoomSocket | null>(null)
  const projection =
    replacedRoomId === roomId && canonicalProjection?.kind === 'admitted'
      ? projectDisplacedRoom(canonicalProjection)
      : canonicalProjection
  const previousKind = useRef(projection?.kind)
  const authenticated =
    projection?.kind === 'admitted' ||
    ((projection?.kind === 'preAdmission' || projection?.kind === 'pastStream') &&
      projection.room.viewerAuthenticated)

  useEffect(() => {
    if (!authenticated) return
    const socket = io({ path: '/socket.io/', withCredentials: true })
    // The room's realtime surface shares this one connection (ADR 0104); a
    // second `io()` would displace it in the connection registry.
    setRoomSocket(socket)
    const unbind = bindRoomProjectionSocket(socket, {
      onRefresh: () => {
        void invalidateRoomProjection(queryClient, roomId)
      },
      onRoomEvent: (value) => {
        void applyRoomProjectionRealtimeEvent(queryClient, roomId, value)
      },
      onTerminal: () => {
        setConfirmation(null)
        setConfirmationAction(null)
        setPassword(undefined)
        setError(null)
      },
      onReplacement: () => setReplacedRoomId(roomId),
    })
    return () => {
      setRoomSocket(null)
      unbind()
    }
  }, [authenticated, queryClient, roomId])

  useEffect(() => {
    const kind = projection?.kind
    if (!kind || previousKind.current === kind) {
      previousKind.current = kind
      return
    }
    previousKind.current = kind
    setConfirmation(null)
    setConfirmationAction(null)
    setPassword(undefined)
    focusRoomPrimaryHeading()
  }, [projection?.kind])

  if (!projection) return <RoomNotFound />
  if (projection.kind === 'pastStream') {
    return <PastStreamSummary room={projection.room} session={session} />
  }
  if (projection.kind === 'admitted') {
    return (
      <>
        <RoomAdmittedBoundary
          room={projection.room}
          self={projection.self}
          session={session}
          socket={roomSocket}
          onConfirmation={(next) => {
            setError(null)
            setConfirmationAction('leave')
            setConfirmation(next)
          }}
          onLeft={(roomState) => {
            if (roomState === 'ended') void roomQuery.refetch()
            else window.location.assign('/')
          }}
        />
        <MembershipConsequencesDialog
          pending={roomQuery.isFetching || commandPending}
          error={error}
          confirmation={confirmationAction === 'leave' ? confirmation : null}
          open={confirmationAction === 'leave' && Boolean(confirmation)}
          onCancel={clearConfirmation}
          onConfirm={(next) => void confirmTransition(next)}
        />
        {error && !confirmation && (
          <p className="form-error room-boundary__error" role="alert">{error}</p>
        )}
      </>
    )
  }
  return (
    <>
      <RoomPreAdmission
        room={projection.room}
        session={session}
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
        onCancel={clearConfirmation}
        onConfirm={(next) => void confirmTransition(next)}
      />
      {error && !confirmation && (
        <p className="form-error room-boundary__error" role="alert">{error}</p>
      )}
    </>
  )

  function clearConfirmation() {
    setConfirmation(null)
    setConfirmationAction(null)
  }

  async function confirmTransition(next: MembershipConfirmation) {
    setError(null)
    setCommandPending(true)
    try {
      if (confirmationAction === 'admit') {
        const result = await admitRoom({ data: { roomId, password, confirmation: next } })
        if (result.status === 'joined' || result.status === 'already-member') {
          clearConfirmation()
          await roomQuery.refetch()
        } else if (result.status === 'confirmation-required') {
          setConfirmation(result.confirmation)
        } else {
          clearConfirmation()
          await roomQuery.refetch()
          setError('The room changed before admission could complete.')
        }
        return
      }
      if (projection?.kind !== 'admitted') {
        clearConfirmation()
        await roomQuery.refetch()
        return
      }
      const result = await leaveRoom({
        data: {
          roomId,
          membershipId: projection.self.id,
          confirmation: next,
        },
      })
      if (result.status === 'left') {
        clearConfirmation()
        if (result.roomState === 'ended') await roomQuery.refetch()
        else window.location.assign('/')
      }
      else if (result.status === 'confirmation-required') setConfirmation(result.confirmation)
      else {
        clearConfirmation()
        await roomQuery.refetch()
        setError('The membership changed before leaving could complete.')
      }
    } catch {
      setError('Unable to complete room change. Try again.')
    } finally {
      setCommandPending(false)
    }
  }
}
