import { useEffect, useRef, useState } from 'react'
import type { RoomRosterMember } from '../../server/rooms/room-roster'
import { hostStopStream } from './room-queries'
import { observeRoom } from './room-observability'

interface RoomHostStreamStopDialogProps {
  readonly roomId: string
  readonly target: RoomRosterMember | null
  readonly onClose: () => void
}

export function RoomHostStreamStopDialog({
  roomId,
  target,
  onClose,
}: RoomHostStreamStopDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !target || dialog.open) return
    dialog.showModal()
    cancelRef.current?.focus()
  }, [target])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || target) return
    if (dialog.open) dialog.close()
    setPending(false)
    setError(null)
  }, [target])

  if (!target || !target.streamId) return null
  const titleId = `room-stream-stop-title-${target.membershipId}`
  const consequenceId = `room-stream-stop-consequence-${target.membershipId}`

  const cancel = () => {
    if (pending) return
    observeRoom({ name: 'room_host_stream_stop_confirmation_cancelled', properties: {} })
    onClose()
  }

  const confirm = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    observeRoom({ name: 'room_host_stream_stop_confirmation_confirmed', properties: {} })
    const result = await hostStopStream({
      data: {
        roomId,
        targetAccountId: target.accountId,
        streamId: target.streamId,
      },
    }).catch(() => null)
    setPending(false)
    if (result?.status === 'stopped') {
      onClose()
      return
    }
    setError(
      result?.status === 'not-streaming'
        ? `${target.displayName} is no longer sharing.`
        : result?.status === 'not-member'
          ? `${target.displayName} is no longer in this room.`
          : 'The Stream could not be stopped. The room is unchanged.',
    )
  }

  return (
    <dialog
      ref={dialogRef}
      aria-describedby={consequenceId}
      aria-labelledby={titleId}
      className="room-ban-dialog"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) cancel()
      }}
    >
      <div className="room-ban-dialog__panel">
        <p className="room-ban-dialog__eyebrow">Host Stream Stop</p>
        <h2 id={titleId}>Stop {target.displayName}’s current Stream?</h2>
        <p id={consequenceId}>
          Only {target.displayName}’s current Stream and its related watches will end. They
          will stay in the room and may start another Stream through the normal gates.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="room-ban-dialog__actions">
          <button ref={cancelRef} disabled={pending} type="button" onClick={cancel}>
            Cancel
          </button>
          <button
            aria-busy={pending}
            className="room-ban-dialog__confirm"
            disabled={pending}
            type="button"
            onClick={() => void confirm()}
          >
            {pending ? 'Stopping…' : `Stop ${target.displayName}’s Stream`}
          </button>
        </div>
      </div>
    </dialog>
  )
}
